const path = require("node:path");
const { BrowserWindow, ipcMain, shell } = require("electron");
const {
  isAllowedNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

const STATE_KEY = "external_assistant_state";
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 640;

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
    webContents.on("will-attach-webview", (event, attachedWebPreferences, params) => {
      const providerId = params.webPreferences?.partition === "persist:external-assistant-gemini"
        ? "gemini"
        : "chatgpt";
      const result = validateWebviewAttachment({
        src: params.src,
        partition: params.webPreferences?.partition,
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

    // Each webview's contents, once attached, is gated on navigation.
    webContents.on("did-attach-webview", (_event, webviewContents) => {
      webviewContents.on("will-navigate", (navEvent, url) => {
        const partition = webviewContents.session.getUserPartitionName();
        const providerId = partition === "persist:external-assistant-gemini" ? "gemini" : "chatgpt";
        if (isAllowedNavigation(providerId, url)) return;
        navEvent.preventDefault();
        void shell.openExternal(url);
      });
      webviewContents.setWindowOpenHandler(({ url }) => {
        const partition = webviewContents.session.getUserPartitionName();
        const providerId = partition === "persist:external-assistant-gemini" ? "gemini" : "chatgpt";
        if (isAllowedNavigation(providerId, url)) return { action: "allow" };
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
