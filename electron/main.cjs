const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { OpenNotionBackend } = require("./backend.cjs");

const LEGACY_TAURI_CONFIG_DIR = "org.opennotion.desktop";
const MAX_DIALOG_FILTERS = 10;
const MAX_DIALOG_EXTENSIONS = 20;
let mainWindow = null;
let backend = null;

function configureAppIdentity() {
  app.setName("OpenNotion");
  const userDataPath = process.env.OPENNOTION_USER_DATA_DIR
    ? path.resolve(process.env.OPENNOTION_USER_DATA_DIR)
    : path.join(app.getPath("appData"), LEGACY_TAURI_CONFIG_DIR);
  app.setPath("userData", userDataPath);
}

function createBackend() {
  if (backend) return backend;
  backend = new OpenNotionBackend({
    appConfigDir: app.getPath("userData"),
    openPath: (filePath) => shell.openPath(filePath),
    revealPath: (filePath) => shell.showItemInFolder(filePath),
  });
  return backend;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "OpenNotion",
    backgroundColor: "#f7f7f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.on("console-message", (details) => {
    console.log(`[renderer:${details.level}] ${details.message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer-gone] ${details.reason}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trustedSender(event) {
  const senderUrl = event.senderFrame?.url || "";
  if (senderUrl.startsWith("file://")) return true;
  if (!process.env.ELECTRON_RENDERER_URL) return false;
  try {
    return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
  } catch {
    return false;
  }
}

function requireTrustedSender(event) {
  if (!trustedSender(event)) {
    throw new Error("untrusted renderer origin");
  }
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return undefined;
  return filters.slice(0, MAX_DIALOG_FILTERS).flatMap((filter) => {
    if (!isRecord(filter) || typeof filter.name !== "string" || !Array.isArray(filter.extensions)) return [];
    return [{
      name: filter.name.slice(0, 80),
      extensions: filter.extensions
        .filter((extension) => typeof extension === "string" && /^[a-zA-Z0-9]+$/.test(extension))
        .slice(0, MAX_DIALOG_EXTENSIONS),
    }];
  }).filter((filter) => filter.extensions.length > 0);
}

function normalizeOpenDialogOptions(options = {}) {
  const safeOptions = isRecord(options) ? options : {};
  const properties = ["openFile"];
  if (safeOptions.multiple === true) properties.push("multiSelections");
  return {
    properties,
    filters: normalizeFilters(safeOptions.filters),
  };
}

function normalizeSaveDialogOptions(options = {}) {
  const safeOptions = isRecord(options) ? options : {};
  return {
    defaultPath: typeof safeOptions.defaultPath === "string" ? safeOptions.defaultPath : undefined,
    filters: normalizeFilters(safeOptions.filters),
  };
}

function registerIpc() {
  ipcMain.handle("opennotion:invoke", async (event, payload = {}) => {
    requireTrustedSender(event);
    if (!isRecord(payload) || typeof payload.command !== "string") {
      throw new Error("invalid invoke payload");
    }
    if (payload.command === "show_character_palette") {
      if (typeof app.showEmojiPanel === "function") app.showEmojiPanel();
      return null;
    }
    return await createBackend().invoke(payload.command, isRecord(payload.args) ? payload.args : {});
  });

  ipcMain.handle("opennotion:dialog-open", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parent, normalizeOpenDialogOptions(options));
    if (result.canceled) return null;
    return isRecord(options) && options.multiple === true ? result.filePaths : result.filePaths[0] || null;
  });

  ipcMain.handle("opennotion:dialog-save", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showSaveDialog(parent, normalizeSaveDialogOptions(options));
    if (result.canceled) return null;
    return result.filePath || null;
  });
}

configureAppIdentity();
registerIpc();

app.whenReady().then(() => {
  createBackend();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backend) backend.close();
  backend = null;
});
