const path = require("node:path");
const {
  BrowserWindow: ElectronBrowserWindow,
  ipcMain: electronIpcMain,
  session: electronSession,
  shell: electronShell,
} = require("electron");
const {
  PROVIDERS,
  isAllowedNavigation,
  isProviderAppNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

const STATE_KEY = "external_assistant_state";
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 640;
const configuredWebAuthnSessions = new WeakSet();

// Map each provider's persistent session to its id, so navigation handlers
// can recover the provider after the webview attaches. Electron's Session
// has no public getPartitionName() API, so we resolve by reference.
function buildSessionToProviderMap(sessionApi) {
  const map = new Map();
  for (const provider of PROVIDERS) {
    const providerSession = sessionApi.fromPartition(provider.partition);
    configureWebAuthnSession(providerSession);
    map.set(providerSession, provider.id);
  }
  return map;
}

function configureWebAuthnSession(providerSession) {
  if (!providerSession || configuredWebAuthnSessions.has(providerSession)) return;
  configuredWebAuthnSessions.add(providerSession);
  if (typeof providerSession.on !== "function") return;

  providerSession.on("select-webauthn-account", (_event, details, callback) => {
    const accounts = Array.isArray(details?.accounts) ? details.accounts : [];
    const selected = accounts[0];
    callback(selected?.credentialId ?? null);
  });
}

function createExternalAssistantController({
  getMainWindow,
  backend,
  electron = {
    BrowserWindow: ElectronBrowserWindow,
    ipcMain: electronIpcMain,
    session: electronSession,
    shell: electronShell,
  },
}) {
  const { BrowserWindow, ipcMain, session, shell } = electron;
  let childWindow = null;
  let wasOpenForUser = false;
  let blurHideTimer = null;
  let persistTimer = null;
  let allowClose = false;
  let focusTrackedWindow = null;

  function clearBlurHideTimer() {
    if (!blurHideTimer) return;
    clearTimeout(blurHideTimer);
    blurHideTimer = null;
  }

  function configureProviderSessions() {
    for (const provider of PROVIDERS) {
      configureWebAuthnSession(session.fromPartition(provider.partition));
    }
  }

  function readState() {
    try {
      const parsed = readRawState();
      if (
        typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        typeof parsed.x !== "number" || typeof parsed.y !== "number" ||
        typeof parsed.width !== "number" || typeof parsed.height !== "number" ||
        typeof parsed.lastOpenedAt !== "string"
      ) {
        return null;
      }
      const provider = parsed.provider === "gemini" ? "gemini" : "chatgpt";
      return { ...parsed, provider };
    } catch {
      return null;
    }
  }

  function readRawState() {
    const raw = backend.readMetadataValue(STATE_KEY);
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : null;
  }

  function persistState(partial) {
    try {
      const current = readRawState() ?? {};
      const next = { ...current, ...partial, lastOpenedAt: new Date().toISOString() };
      backend.writeMetadataValue(STATE_KEY, JSON.stringify(next));
    } catch {
      // Persistence is best-effort; never crash the app over it.
    }
  }

  function scheduleBoundsPersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (!childWindow) return;
      try {
        const [x, y] = childWindow.getPosition();
        const [width, height] = childWindow.getSize();
        persistState({ x, y, width, height });
      } catch {
        // window may have been closed mid-timer
      }
    }, 250);
  }

  function defaultBounds() {
    const main = getMainWindow();
    if (!main) return { x: 120, y: 120, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    const [mw, mh] = main.getSize();
    const [mx, my] = main.getPosition();
    const margin = 16;
    return {
      x: mx + mw - DEFAULT_WIDTH - margin,
      y: my + mh - DEFAULT_HEIGHT - margin,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }

  function currentBounds() {
    if (!childWindow || childWindow.isDestroyed()) return null;
    const [x, y] = childWindow.getPosition();
    const [width, height] = childWindow.getSize();
    return { x, y, width, height };
  }

  function openProviderPopup(providerId, url) {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;
    configureWebAuthnSession(session.fromPartition(provider.partition));
    if (!isAllowedNavigation(providerId, url)) {
      void shell.openExternal(url);
      return;
    }

    const popup = new BrowserWindow({
      parent: childWindow && !childWindow.isDestroyed() ? childWindow : getMainWindow() ?? undefined,
      show: true,
      width: 520,
      height: 720,
      title: provider.label,
      webPreferences: {
        partition: provider.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });

    popup.webContents.on("will-navigate", (event, targetUrl) => {
      if (isAllowedNavigation(providerId, targetUrl)) return;
      event.preventDefault();
      void shell.openExternal(targetUrl);
    });
    popup.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isAllowedNavigation(providerId, targetUrl)) {
        openProviderPopup(providerId, targetUrl);
      } else {
        void shell.openExternal(targetUrl);
      }
      return { action: "deny" };
    });
    void popup.loadURL(url);
  }

  function attachSecurityHandlers(webContents) {
    // Defense-in-depth: validate every <webview> before it attaches.
    // Callback signature: (event, webPreferences, params) where
    //   - webPreferences (2nd arg) carries preload/nodeIntegration/contextIsolation
    //   - params (3rd arg) is a flat { src, partition } record
    webContents.on("will-attach-webview", (event, attachedWebPreferences, params) => {
      const partition = typeof params?.partition === "string" ? params.partition : undefined;
      // Derive the provider from the partition via the provider table so the
      // mapping stays single-sourced. An unrecognized partition resolves to
      // null, and validateWebviewAttachment then fails on partition mismatch.
      const providerId = PROVIDERS.find((p) => p.partition === partition)?.id ?? null;
      if (!providerId) {
        console.error("[external-assistant] blocked webview attachment: unrecognized partition");
        event.preventDefault();
        return;
      }
      const result = validateWebviewAttachment({
        src: params?.src,
        partition,
        preload: attachedWebPreferences.preload,
        nodeIntegration: Boolean(attachedWebPreferences.nodeIntegration),
        contextIsolation: attachedWebPreferences.contextIsolation !== false,
        providerId,
      });
      if (!result.ok) {
        console.error(`[external-assistant] blocked webview attachment: ${result.reason}`);
        event.preventDefault();
      }
    });

    // Resolve provider by session reference (Electron has no public
    // getPartitionName() API). Built once; sessions are interned by Electron.
    const sessionToProvider = buildSessionToProviderMap(session);

    // Each webview's contents, once attached, is gated on navigation.
    webContents.on("did-attach-webview", (_event, webviewContents) => {
      webviewContents.on("will-navigate", (navEvent, url) => {
        const providerId = sessionToProvider.get(webviewContents.session) ?? null;
        if (providerId && isAllowedNavigation(providerId, url)) return;
        navEvent.preventDefault();
        void shell.openExternal(url);
      });
      // Provider/auth popups stay in the provider's persistent partition.
      // Everything else is routed to the system browser so the popover never
      // becomes a generic in-app browser.
      webviewContents.setWindowOpenHandler(({ url }) => {
        const providerId = sessionToProvider.get(webviewContents.session) ?? null;
        if (providerId && isProviderAppNavigation(providerId, url)) {
          void webviewContents.loadURL(url);
        } else if (providerId && isAllowedNavigation(providerId, url)) {
          openProviderPopup(providerId, url);
        } else {
          void shell.openExternal(url);
        }
        return { action: "deny" };
      });
    });
  }

  function ensureWindow() {
    if (childWindow && !childWindow.isDestroyed()) return childWindow;
    wireFocusTracking();
    const main = getMainWindow();
    const saved = readState();
    const bounds = saved
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : defaultBounds();

    childWindow = new BrowserWindow({
      parent: main ?? undefined,
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      minWidth: 320,
      minHeight: 400,
      maxWidth: 560,
      maxHeight: 900,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      backgroundColor: process.platform === "darwin" ? "#00000000" : "#111111",
      transparent: process.platform === "darwin",
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "external-assistant-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
      },
    });

    attachSecurityHandlers(childWindow.webContents);
    if (process.platform === "darwin" && typeof childWindow.setWindowButtonVisibility === "function") {
      childWindow.setWindowButtonVisibility(false);
    }

    childWindow.on("move", scheduleBoundsPersist);
    childWindow.on("resize", scheduleBoundsPersist);
    childWindow.on("focus", clearBlurHideTimer);
    childWindow.on("close", (event) => {
      // Close hides instead of destroying, so webview sessions stay alive.
      if (allowClose) return;
      event.preventDefault();
      hide();
    });
    childWindow.on("closed", () => {
      childWindow = null;
    });

    // alwaysOnTop follows main-window focus (see wireFocusTracking).
    childWindow.setAlwaysOnTop(true, "floating");

    childWindow.loadURL("opennotion-app://renderer/external-assistant.html");
    return childWindow;
  }

  function show(provider) {
    const win = ensureWindow();
    win.show();
    win.focus();
    wasOpenForUser = true;
    persistState({
      ...currentBounds(),
      ...(provider ? { provider } : {}),
    });
  }

  function hide() {
    if (!childWindow || childWindow.isDestroyed()) return;
    persistState(currentBounds() ?? {});
    childWindow.hide();
    wasOpenForUser = false;
  }

  function toggle(options = {}) {
    const win = ensureWindow();
    if (win.isVisible() && wasOpenForUser) {
      hide();
      return;
    }
    show(typeof options.provider === "string" ? options.provider : undefined);
  }

  function wireFocusTracking() {
    const main = getMainWindow();
    if (!main) return;
    if (main === focusTrackedWindow) return;
    focusTrackedWindow = main;
    main.on("focus", () => {
      clearBlurHideTimer();
      if (wasOpenForUser && childWindow && !childWindow.isDestroyed()) {
        childWindow.show();
      }
    });
    main.on("blur", () => {
      if (!wasOpenForUser) return;
      clearBlurHideTimer();
      blurHideTimer = setTimeout(() => {
        blurHideTimer = null;
        if (!childWindow || childWindow.isDestroyed()) return;
        const mainFocused = typeof main.isFocused === "function" && main.isFocused();
        const childFocused = typeof childWindow.isFocused === "function" && childWindow.isFocused();
        if (!mainFocused && !childFocused) childWindow.hide();
      }, 100);
    });
  }

  function registerIpc() {
    ipcMain.handle("external-assistant:toggle", (_event, options) => {
      try {
        toggle(options && typeof options === "object" ? options : {});
      } catch (error) {
        console.error(`[external-assistant] toggle failed: ${error?.message ?? error}`);
      }
      return null;
    });
    ipcMain.handle("external-assistant:get-state", () => {
      const saved = readState();
      return { provider: saved?.provider ?? "chatgpt" };
    });
    ipcMain.handle("external-assistant:set-provider", (_event, provider) => {
      if (provider === "chatgpt" || provider === "gemini") {
        persistState({ provider });
      }
      return null;
    });
    ipcMain.handle("external-assistant:open-provider-external", (_event, providerId) => {
      const provider = PROVIDERS.find((p) => p.id === providerId);
      if (provider) void shell.openExternal(provider.url);
      return null;
    });
    ipcMain.on("external-assistant:close", () => hide());
  }

  return {
    init() {
      configureProviderSessions();
      registerIpc();
      wireFocusTracking();
    },
    destroy() {
      clearBlurHideTimer();
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      if (!childWindow || childWindow.isDestroyed()) return;
      allowClose = true;
      childWindow.destroy();
      childWindow = null;
      allowClose = false;
      wasOpenForUser = false;
    },
    // Exposed for unit-style smoke; not used directly by the renderer.
    _internal: { ensureWindow, show, hide, toggle, readState, persistState },
  };
}

module.exports = { createExternalAssistantController, STATE_KEY };
