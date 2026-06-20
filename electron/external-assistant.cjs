const path = require("node:path");
const { BrowserWindow, ipcMain, session, shell } = require("electron");
const {
  PROVIDERS,
  isAllowedNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

const STATE_KEY = "external_assistant_state";
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 640;

// Map each provider's persistent session to its id, so navigation handlers
// can recover the provider after the webview attaches. Electron's Session
// has no public getPartitionName() API, so we resolve by reference.
function buildSessionToProviderMap() {
  const map = new Map();
  for (const provider of PROVIDERS) {
    map.set(session.fromPartition(provider.partition), provider.id);
  }
  return map;
}

function createExternalAssistantController({ getMainWindow, backend }) {
  let childWindow = null;
  let wasOpenForUser = false;
  let blurHideTimer = null;
  let persistTimer = null;

  function readState() {
    try {
      const raw = backend.readMetadataValue(STATE_KEY);
      if (typeof raw !== "string") return null;
      const parsed = JSON.parse(raw);
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

  function persistState(partial) {
    try {
      const current = readState() ?? {};
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
    const sessionToProvider = buildSessionToProviderMap();

    // Each webview's contents, once attached, is gated on navigation.
    webContents.on("did-attach-webview", (_event, webviewContents) => {
      webviewContents.on("will-navigate", (navEvent, url) => {
        const providerId = sessionToProvider.get(webviewContents.session) ?? null;
        if (providerId && isAllowedNavigation(providerId, url)) return;
        navEvent.preventDefault();
        void shell.openExternal(url);
      });
      // Deny all window.open / target=_blank and route to the system browser.
      // An "allow" here would spawn a new BrowserWindow without our security
      // handlers attached, defeating the allowlist. Mirrors main.cjs posture.
      webviewContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: "deny" };
      });
    });
  }

  function ensureWindow() {
    if (childWindow && !childWindow.isDestroyed()) return childWindow;
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

    childWindow.on("move", scheduleBoundsPersist);
    childWindow.on("resize", scheduleBoundsPersist);
    childWindow.on("close", (event) => {
      // Close hides instead of destroying, so webview sessions stay alive.
      event.preventDefault();
      hide();
    });

    // alwaysOnTop follows main-window focus (see wireFocusTracking).
    childWindow.setAlwaysOnTop(true, "floating");

    childWindow.loadURL("opennotion-app://renderer/external-assistant.html");
    return childWindow;
  }

  function show(provider) {
    const win = ensureWindow();
    if (provider) persistState({ provider });
    win.show();
    win.focus();
    wasOpenForUser = true;
    persistState({ lastOpenedAt: new Date().toISOString() });
  }

  function hide() {
    if (!childWindow || childWindow.isDestroyed()) return;
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
    main.on("focus", () => {
      if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
      if (wasOpenForUser && childWindow && !childWindow.isDestroyed()) {
        childWindow.show();
      }
    });
    main.on("blur", () => {
      if (!wasOpenForUser) return;
      if (blurHideTimer) clearTimeout(blurHideTimer);
      blurHideTimer = setTimeout(() => {
        blurHideTimer = null;
        if (childWindow && !childWindow.isDestroyed()) childWindow.hide();
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
    ipcMain.on("external-assistant:close", () => hide());
  }

  return {
    init() {
      registerIpc();
      wireFocusTracking();
    },
    // Exposed for unit-style smoke; not used directly by the renderer.
    _internal: { ensureWindow, show, hide, toggle, readState, persistState },
  };
}

module.exports = { createExternalAssistantController, STATE_KEY };
