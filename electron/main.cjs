const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require("electron");
const { pathToFileURL } = require("node:url");
const { OpenNotionBackend } = require("./backend.cjs");

const APP_PROTOCOL = "opennotion-app";
const APP_RENDERER_HOST = "renderer";
const APP_ASSET_HOST = "asset";
const LEGACY_TAURI_CONFIG_DIR = "org.opennotion.desktop";
const MAX_DIALOG_FILTERS = 10;
const MAX_DIALOG_EXTENSIONS = 20;
let mainWindow = null;
let backend = null;
let studioPdfServer = null;
let studioPdfServerOrigin = null;
let autoUpdater = null;
let autoUpdaterActive = false;
let updateReadyToInstall = false;

protocol.registerSchemesAsPrivileged([{
  scheme: APP_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

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
    downloadsDir: app.getPath("downloads"),
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

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function trustedRendererOrigin() {
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(process.env.ELECTRON_RENDERER_URL).origin;
    } catch {
      console.error(
        `Invalid ELECTRON_RENDERER_URL (${process.env.ELECTRON_RENDERER_URL}); Studio PDF requests will be refused`
      );
      return null;
    }
  }
  return `${APP_PROTOCOL}://${APP_RENDERER_HOST}`;
}

function isTrustedPdfRequestOrigin(origin) {
  if (!origin) return false;
  const trustedOrigin = trustedRendererOrigin();
  return origin === trustedOrigin;
}

function studioPdfHeaders(origin, extraHeaders = {}) {
  const corsHeaders = isTrustedPdfRequestOrigin(origin)
    ? { "Access-Control-Allow-Origin": origin }
    : {};
  return {
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
    ...corsHeaders,
    ...extraHeaders,
  };
}

function writeStudioPdfHeaders(response, statusCode, origin, extraHeaders = {}) {
  response.writeHead(statusCode, studioPdfHeaders(origin, extraHeaders));
}

function sendStudioPdfError(response, statusCode, message, origin, extraHeaders = {}) {
  writeStudioPdfHeaders(response, statusCode, origin, extraHeaders);
  response.end(message);
}

function createStudioPdfResponse(response, filePath, rangeHeader, origin) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    sendStudioPdfError(response, 404, "Studio PDF not found", origin);
    return;
  }

  if (stats.size <= 0) {
    sendStudioPdfError(response, 404, "Studio PDF is empty", origin);
    return;
  }

  const range = parseByteRange(rangeHeader, stats.size);
  if (range?.invalid) {
    writeStudioPdfHeaders(response, 416, origin, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : stats.size - 1;
  const contentLength = end - start + 1;

  writeStudioPdfHeaders(response, range ? 206 : 200, origin, {
    "Content-Length": String(contentLength),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` } : {}),
  });
  fs.createReadStream(filePath, { start, end }).pipe(response);
}

function handleStudioPdfRequest(request, response) {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (request.method === "OPTIONS") {
    if (!isTrustedPdfRequestOrigin(origin)) {
      sendStudioPdfError(response, 403, "Forbidden", origin);
      return;
    }
    writeStudioPdfHeaders(response, 204, origin);
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendStudioPdfError(response, 405, "Method not allowed", origin);
    return;
  }
  // The only legitimate client is the renderer's pdf.js fetch, which is
  // always cross-origin to this 127.0.0.1 server and therefore always sends
  // an Origin header. Reject anything else (e.g. other local processes)
  // explicitly instead of relying on the browser dropping the CORS-less
  // response.
  if (!isTrustedPdfRequestOrigin(origin)) {
    sendStudioPdfError(response, 403, "Forbidden", origin);
    return;
  }

  const documentId = parseStudioPdfDocumentId(request.url || "");
  if (!documentId) {
    sendStudioPdfError(response, 404, "Studio PDF not found", origin);
    return;
  }

  try {
    const filePath = createBackend().resolveStudioDocumentPdfPath(documentId);
    const rangeHeader = Array.isArray(request.headers.range) ? request.headers.range[0] : request.headers.range;
    createStudioPdfResponse(response, filePath, rangeHeader, origin);
  } catch {
    sendStudioPdfError(response, 404, "Studio PDF not found", origin);
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

function packagedRendererUrl() {
  return `${APP_PROTOCOL}://${APP_RENDERER_HOST}/index.html`;
}

function isTrustedRendererUrl(targetUrl) {
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(targetUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === `${APP_PROTOCOL}:` && parsed.hostname === APP_RENDERER_HOST;
  } catch {
    return false;
  }
}

function plainTextResponse(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function resolveFileUnderRoot(rootPath, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("\0")) return null;

  let canonicalRoot;
  let canonicalPath;
  try {
    canonicalRoot = fs.realpathSync(rootPath);
    canonicalPath = fs.realpathSync(path.join(canonicalRoot, relativePath));
  } catch {
    return null;
  }

  if (!isPathInside(canonicalRoot, canonicalPath)) return null;
  if (!fs.statSync(canonicalPath).isFile()) return null;
  return canonicalPath;
}

async function fileResponse(filePath) {
  return await net.fetch(pathToFileURL(filePath).toString());
}

async function handleAppProtocolRequest(request) {
  if (request.method !== "GET") return plainTextResponse(405, "Method not allowed");

  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return plainTextResponse(400, "Bad request");
  }

  if (parsed.protocol !== `${APP_PROTOCOL}:`) return plainTextResponse(400, "Bad request");

  if (parsed.hostname === APP_RENDERER_HOST) {
    const filePath = resolveFileUnderRoot(path.join(__dirname, "..", "dist"), parsed.pathname);
    return filePath ? await fileResponse(filePath) : plainTextResponse(404, "Not found");
  }

  if (parsed.hostname === APP_ASSET_HOST) {
    try {
      const assetToken = parsed.pathname.replace(/^\/+/, "");
      return await fileResponse(createBackend().resolveManagedAssetPath(assetToken));
    } catch {
      return plainTextResponse(404, "Not found");
    }
  }

  return plainTextResponse(404, "Not found");
}

function configureAppProtocol() {
  protocol.handle(APP_PROTOCOL, handleAppProtocolRequest);
}

function shouldOpenExternal(targetUrl) {
  try {
    return new URL(targetUrl).protocol === "https:";
  } catch {
    return false;
  }
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
      webSecurity: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadURL(packagedRendererUrl());
  }

  mainWindow.webContents.on("console-message", (details) => {
    if (details.message.includes("Download the React DevTools")) return;
    console.log(`[renderer:${details.level}] ${details.message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer-gone] ${details.reason}`);
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (isTrustedRendererUrl(targetUrl)) return;
    event.preventDefault();
    if (shouldOpenExternal(targetUrl)) void shell.openExternal(targetUrl);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternal(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function notifyRenderer(channel, payload = null) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function configureWindowsAutoUpdater() {
  if (process.platform !== "win32" || !app.isPackaged) return;

  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (error) {
    console.warn("[updater] electron-updater unavailable", error);
    return;
  }

  autoUpdaterActive = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    notifyRenderer("desktop-update-checking");
  });
  autoUpdater.on("update-available", (info) => {
    notifyRenderer("desktop-update-available", {
      version: info.version,
      releaseName: info.releaseName,
      releaseDate: info.releaseDate,
    });
  });
  autoUpdater.on("update-not-available", () => {
    notifyRenderer("desktop-update-not-available");
  });
  autoUpdater.on("download-progress", (progress) => {
    notifyRenderer("desktop-update-download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateReadyToInstall = true;
    notifyRenderer("desktop-update-downloaded", {
      version: info.version,
      releaseName: info.releaseName,
      releaseDate: info.releaseDate,
    });
  });
  autoUpdater.on("error", (error) => {
    console.warn("[updater] Windows auto update failed", error);
    notifyRenderer("desktop-update-error", error instanceof Error ? error.message : "Windows auto update failed");
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.warn("[updater] Windows update check failed", error);
    });
  }, 5000);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trustedSender(event) {
  const senderUrl = event.senderFrame?.url || "";
  return isTrustedRendererUrl(senderUrl);
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

  ipcMain.on("opennotion:file-src", (event, filePath) => {
    try {
      requireTrustedSender(event);
      if (typeof filePath !== "string" || filePath.trim() === "") {
        throw new Error("file path must be a string");
      }
      event.returnValue = { ok: true, value: createBackend().fileSrc(filePath) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : "failed to create file URL",
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

  // Export/import run dialog + file IO in one round trip so the renderer
  // never passes filesystem paths over IPC: the only paths that reach fs are
  // the ones the user just picked in a native dialog.
  ipcMain.handle("opennotion:export-files", async (event, options = {}) => {
    requireTrustedSender(event);
    if (!isRecord(options) || !Array.isArray(options.files)) {
      throw new Error("invalid export payload");
    }
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showSaveDialog(parent, normalizeSaveDialogOptions(options));
    if (result.canceled || !result.filePath) return null;
    return createBackend().writeExportFiles({ targetPath: result.filePath, files: options.files });
  });

  ipcMain.handle("opennotion:import-page-file", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parent, normalizeOpenDialogOptions(options));
    if (result.canceled || !result.filePaths[0]) return null;
    return createBackend().readImportFile({ path: result.filePaths[0] });
  });

  ipcMain.on("opennotion:auto-update-active", (event) => {
    try {
      requireTrustedSender(event);
      event.returnValue = { ok: true, value: autoUpdaterActive };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : "untrusted renderer origin" };
    }
  });

  ipcMain.handle("opennotion:install-update-now", (event) => {
    requireTrustedSender(event);
    if (!autoUpdater || !updateReadyToInstall) {
      throw new Error("no downloaded update is ready to install");
    }
    // Defer so the invoke reply reaches the renderer before the app quits.
    setImmediate(() => {
      autoUpdater.quitAndInstall();
    });
    return null;
  });
}

configureAppIdentity();
registerIpc();

app.whenReady().then(async () => {
  configureApplicationMenu();
  configureAppProtocol();
  createBackend();
  await startStudioPdfServer();
  createMainWindow();
  configureWindowsAutoUpdater();

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
