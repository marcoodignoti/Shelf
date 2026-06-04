const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { OpenNotionBackend } = require("./backend.cjs");

const LEGACY_TAURI_CONFIG_DIR = "org.opennotion.desktop";
const MAX_DIALOG_FILTERS = 10;
const MAX_DIALOG_EXTENSIONS = 20;
let mainWindow = null;
let backend = null;
let studioPdfServer = null;
let studioPdfServerOrigin = null;

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
    openExternalUrl: (url) => shell.openExternal(url),
  });
  return backend;
}

function configureApplicationMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin" ? [
          { type: "separator" },
          { role: "front" },
        ] : [
          { role: "close" },
        ]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function appIconPath() {
  const candidates = [
    path.join(__dirname, "..", "assets", "app-icon.png"),
    path.join(__dirname, "..", "..", "assets", "app-icon.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function parseStudioPdfDocumentId(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl, studioPdfServerOrigin || "http://127.0.0.1");
  } catch {
    return null;
  }

  let parts;
  try {
    parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (parts.length !== 3 || parts[0] !== "studio-document" || parts[2] !== "source.pdf" || parts[1].trim() === "") {
    return null;
  }
  return parts[1];
}

function parseByteRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { invalid: true };

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return { invalid: true };

  let start;
  let end;
  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startValue);
    end = endValue ? Number(endValue) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

function studioPdfHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
    ...extraHeaders,
  };
}

function writeStudioPdfHeaders(response, statusCode, extraHeaders = {}) {
  response.writeHead(statusCode, studioPdfHeaders(extraHeaders));
}

function sendStudioPdfError(response, statusCode, message, extraHeaders = {}) {
  writeStudioPdfHeaders(response, statusCode, extraHeaders);
  response.end(message);
}

function createStudioPdfResponse(response, filePath, rangeHeader) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    sendStudioPdfError(response, 404, "Studio PDF not found");
    return;
  }

  if (stats.size <= 0) {
    sendStudioPdfError(response, 404, "Studio PDF is empty");
    return;
  }

  const range = parseByteRange(rangeHeader, stats.size);
  if (range?.invalid) {
    writeStudioPdfHeaders(response, 416, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : stats.size - 1;
  const contentLength = end - start + 1;

  writeStudioPdfHeaders(response, range ? 206 : 200, {
    "Content-Length": String(contentLength),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` } : {}),
  });
  fs.createReadStream(filePath, { start, end }).pipe(response);
}

function handleStudioPdfRequest(request, response) {
  if (request.method === "OPTIONS") {
    writeStudioPdfHeaders(response, 204);
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendStudioPdfError(response, 405, "Method not allowed");
    return;
  }

  const documentId = parseStudioPdfDocumentId(request.url || "");
  if (!documentId) {
    sendStudioPdfError(response, 404, "Studio PDF not found");
    return;
  }

  try {
    const filePath = createBackend().resolveStudioDocumentPdfPath(documentId);
    const rangeHeader = Array.isArray(request.headers.range) ? request.headers.range[0] : request.headers.range;
    createStudioPdfResponse(response, filePath, rangeHeader);
  } catch {
    sendStudioPdfError(response, 404, "Studio PDF not found");
  }
}

function startStudioPdfServer() {
  if (studioPdfServerOrigin) return Promise.resolve(studioPdfServerOrigin);

  return new Promise((resolve, reject) => {
    const server = http.createServer(handleStudioPdfRequest);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Studio PDF server did not bind to a TCP port"));
        return;
      }

      studioPdfServer = server;
      studioPdfServerOrigin = `http://127.0.0.1:${address.port}`;
      server.off("error", reject);
      resolve(studioPdfServerOrigin);
    });
  });
}

function studioPdfUrl(documentId) {
  if (!studioPdfServerOrigin) throw new Error("Studio PDF server is not ready");
  return `${studioPdfServerOrigin}/studio-document/${encodeURIComponent(documentId)}/source.pdf`;
}

function createMainWindow() {
  const icon = appIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "OpenNotion",
    backgroundColor: "#f7f7f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 14 },
    ...(icon ? { icon } : {}),
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
    if (details.message.includes("Download the React DevTools")) return;
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
  ipcMain.on("opennotion:studio-pdf-src", (event, documentId) => {
    try {
      requireTrustedSender(event);
      if (typeof documentId !== "string" || documentId.trim() === "") {
        throw new Error("document id must be a string");
      }
      event.returnValue = { ok: true, value: studioPdfUrl(documentId) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : "failed to create Studio PDF URL",
      };
    }
  });

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

app.whenReady().then(async () => {
  configureApplicationMenu();
  createBackend();
  await startStudioPdfServer();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  studioPdfServer?.close();
  studioPdfServer = null;
  studioPdfServerOrigin = null;
  if (backend) backend.close();
  backend = null;
});
