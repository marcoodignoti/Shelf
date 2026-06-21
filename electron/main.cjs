const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeTheme,
  protocol,
  shell,
} = require("electron");
const { pathToFileURL } = require("node:url");
const { ShelfBackend } = require("./backend.cjs");
const { createExternalAssistantController } = require("./external-assistant.cjs");

const APP_PROTOCOL = "opennotion-app";
const APP_RENDERER_HOST = "renderer";
const APP_ASSET_HOST = "asset";
const LEGACY_TAURI_CONFIG_DIR = "org.opennotion.desktop";
const MAX_DIALOG_FILTERS = 10;
const MAX_DIALOG_EXTENSIONS = 20;
const MAC_WEBAUTHN_PROMPT_REASON = "sign in to $1";
const IMAGE_DIALOG_FILTER = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "webp", "gif"],
};
const PDF_DIALOG_FILTER = { name: "PDF", extensions: ["pdf"] };
const BACKUP_DIALOG_FILTER = { name: "Shelf Backup", extensions: ["json"] };
const EDITOR_MEDIA_DIALOG_FILTERS = {
  image: [
    { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
  ],
  video: [{ name: "Videos", extensions: ["mp4", "m4v", "mov", "webm"] }],
};
const RENDERER_PATH_COMMANDS = new Set([
  "export_backup",
  "import_backup",
  "import_studio_document",
  "replace_studio_document_file",
  "import_cover_image",
  "import_profile_avatar",
]);
const RENDERER_SOURCE_PATH_COMMANDS = new Set([
  "import_editor_image",
  "import_editor_video",
]);
let mainWindow = null;
let backend = null;
let externalAssistant = null;
let studioPdfServer = null;
let studioPdfServerOrigin = null;
let studioPdfPort = null;
let studioPdfAccessToken = null;
let trustedDevRendererUrlResolved = false;
let trustedDevRendererUrlValue = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function configureAppIdentity() {
  app.setName("Shelf");
  const configuredUserDataPath =
    process.env.SHELF_USER_DATA_DIR || process.env.OPENNOTION_USER_DATA_DIR;
  const userDataPath = configuredUserDataPath
    ? path.resolve(configuredUserDataPath)
    : path.join(app.getPath("appData"), LEGACY_TAURI_CONFIG_DIR);
  app.setPath("userData", userDataPath);
}

function configureWebAuthn() {
  if (process.platform !== "darwin") return;
  if (typeof app.configureWebAuthn !== "function") return;
  const keychainAccessGroup =
    process.env.SHELF_MAC_WEBAUTHN_KEYCHAIN_ACCESS_GROUP ||
    process.env.OPENNOTION_MAC_WEBAUTHN_KEYCHAIN_ACCESS_GROUP ||
    (process.env.SHELF_MAC_TEAM_ID
      ? `${process.env.SHELF_MAC_TEAM_ID}.com.marcodignoti.shelf.webauthn`
      : "com.marcodignoti.shelf.webauthn");
  if (!keychainAccessGroup) return;
  try {
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup,
        promptReason: MAC_WEBAUTHN_PROMPT_REASON,
      },
    });
  } catch (error) {
    console.warn(`[webauthn] Touch ID WebAuthn unavailable: ${error?.message ?? error}`);
  }
}

function createBackend() {
  if (backend) return backend;
  backend = new ShelfBackend({
    appConfigDir: app.getPath("userData"),
    downloadsDir: app.getPath("downloads"),
    openPath: (filePath) => shell.openPath(filePath),
    revealPath: (filePath) => shell.showItemInFolder(filePath),
    openExternalUrl: (url) => shell.openExternal(url),
  });
  return backend;
}

function configureApplicationMenu() {
  const viewSubmenu = [
    ...(app.isPackaged
      ? []
      : [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
        ]),
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const template = [
    ...(process.platform === "darwin"
      ? [
          {
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
          },
        ]
      : []),
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
      submenu: viewSubmenu,
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
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

const WIN_TITLE_BAR_HEIGHT = 40;

function windowsTitleBarColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? "#171717" : "#f7f7f5",
    symbolColor: dark ? "#e6e6e6" : "#2b2b2b",
    height: WIN_TITLE_BAR_HEIGHT,
  };
}

function applyWindowsTitleBarOverlay(window) {
  if (process.platform !== "win32") return;
  if (!window || window.isDestroyed()) return;
  if (typeof window.setTitleBarOverlay !== "function") return;
  try {
    window.setTitleBarOverlay(windowsTitleBarColors());
  } catch (error) {
    console.warn(
      `[titlebar] failed to apply overlay: ${error?.message ?? error}`,
    );
  }
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
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (
    parts.length !== 3 ||
    parts[0] !== "studio-document" ||
    parts[2] !== "source.pdf" ||
    parts[1].trim() === ""
  ) {
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
    if (!Number.isInteger(suffixLength) || suffixLength <= 0)
      return { invalid: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startValue);
    end = endValue ? Number(endValue) : fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function trustedDevRendererUrl() {
  if (trustedDevRendererUrlResolved) return trustedDevRendererUrlValue;
  trustedDevRendererUrlResolved = true;

  const configured = process.env.ELECTRON_RENDERER_URL;
  if (!configured) return null;

  if (app.isPackaged) {
    console.warn("Ignoring ELECTRON_RENDERER_URL in packaged builds");
    return null;
  }

  try {
    const parsed = new URL(configured);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !isLoopbackHostname(parsed.hostname)
    ) {
      console.error(
        `Ignoring untrusted ELECTRON_RENDERER_URL (${configured}); expected a loopback HTTP(S) URL`,
      );
      return null;
    }
    trustedDevRendererUrlValue = parsed;
    return trustedDevRendererUrlValue;
  } catch {
    console.error(`Ignoring invalid ELECTRON_RENDERER_URL (${configured})`);
    return null;
  }
}

function trustedRendererOrigin() {
  const devRendererUrl = trustedDevRendererUrl();
  if (devRendererUrl) return devRendererUrl.origin;
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
    "Access-Control-Expose-Headers":
      "Accept-Ranges, Content-Length, Content-Range",
    ...corsHeaders,
    ...extraHeaders,
  };
}

function writeStudioPdfHeaders(
  response,
  statusCode,
  origin,
  extraHeaders = {},
) {
  response.writeHead(statusCode, studioPdfHeaders(origin, extraHeaders));
}

function sendStudioPdfError(
  response,
  statusCode,
  message,
  origin,
  extraHeaders = {},
) {
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
    writeStudioPdfHeaders(response, 416, origin, {
      "Content-Range": `bytes */${stats.size}`,
    });
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : stats.size - 1;
  const contentLength = end - start + 1;

  writeStudioPdfHeaders(response, range ? 206 : 200, origin, {
    "Content-Length": String(contentLength),
    ...(range
      ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` }
      : {}),
  });
  fs.createReadStream(filePath, { start, end }).pipe(response);
}

function handleStudioPdfRequest(request, response) {
  const origin = Array.isArray(request.headers.origin)
    ? request.headers.origin[0]
    : request.headers.origin;
  if (request.method === "OPTIONS") {
    if (
      !isTrustedPdfRequestOrigin(origin) ||
      !hasTrustedStudioPdfAccessToken(request.url || "")
    ) {
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
  if (
    !isTrustedPdfRequestOrigin(origin) ||
    !hasTrustedStudioPdfAccessToken(request.url || "")
  ) {
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
    const rangeHeader = Array.isArray(request.headers.range)
      ? request.headers.range[0]
      : request.headers.range;
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
      studioPdfPort = address.port;
      studioPdfAccessToken = crypto.randomBytes(32).toString("base64url");
      server.off("error", reject);
      resolve(studioPdfServerOrigin);
    });
  });
}

function hasTrustedStudioPdfAccessToken(requestUrl) {
  if (!studioPdfAccessToken) return false;
  try {
    const parsed = new URL(
      requestUrl,
      studioPdfServerOrigin || "http://127.0.0.1",
    );
    return parsed.searchParams.get("token") === studioPdfAccessToken;
  } catch {
    return false;
  }
}

function studioPdfUrl(documentId) {
  if (!studioPdfServerOrigin || !studioPdfAccessToken)
    throw new Error("Studio PDF server is not ready");
  return `${studioPdfServerOrigin}/studio-document/${encodeURIComponent(documentId)}/source.pdf?token=${encodeURIComponent(studioPdfAccessToken)}`;
}

function packagedRendererUrl() {
  return `${APP_PROTOCOL}://${APP_RENDERER_HOST}/index.html`;
}

function isTrustedRendererUrl(targetUrl) {
  const devRendererUrl = trustedDevRendererUrl();
  if (devRendererUrl) {
    try {
      return new URL(targetUrl).origin === devRendererUrl.origin;
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(targetUrl);
    return (
      parsed.protocol === `${APP_PROTOCOL}:` &&
      parsed.hostname === APP_RENDERER_HOST
    );
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

  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
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

// Include the actual bound port of the Studio PDF server instead of a
// wildcard, so a compromised renderer cannot exfiltrate to an arbitrary
// local process. ws:// is included because pdf.js worker fetches may
// upgrade; both are loopback-only.
function studioPdfConnectSrc() {
  return studioPdfPort
    ? `http://127.0.0.1:${studioPdfPort} ws://127.0.0.1:${studioPdfPort}`
    : "";
}

async function fileResponse(filePath, contentSecurityPolicy) {
  const response = await net.fetch(pathToFileURL(filePath).toString());
  if (!contentSecurityPolicy) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleAppProtocolRequest(request) {
  if (request.method !== "GET")
    return plainTextResponse(405, "Method not allowed");

  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return plainTextResponse(400, "Bad request");
  }

  if (parsed.protocol !== `${APP_PROTOCOL}:`)
    return plainTextResponse(400, "Bad request");

  if (parsed.hostname === APP_RENDERER_HOST) {
    const filePath = resolveFileUnderRoot(
      path.join(__dirname, "..", "dist"),
      parsed.pathname,
    );
    if (!filePath) return plainTextResponse(404, "Not found");
    const loopback = studioPdfConnectSrc();
    // This is the sole CSP for the packaged app. There is no <meta> CSP in
    // index.html (dual policies are AND'd, which would block loopback access).
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: opennotion-app: blob:",
      "media-src 'self' opennotion-app: blob:",
      loopback ? `connect-src 'self' ${loopback}` : "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
    ].join("; ");
    return await fileResponse(
      filePath,
      filePath.endsWith(".html") ? csp : undefined,
    );
  }

  if (parsed.hostname === APP_ASSET_HOST) {
    try {
      const assetToken = parsed.pathname.replace(/^\/+/, "");
      return await fileResponse(
        createBackend().resolveManagedAssetPath(assetToken),
      );
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
  const isMac = process.platform === "darwin";
  const isWindows = process.platform === "win32";
  const darkAtBoot = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Shelf",
    backgroundColor: isMac
      ? "#00000000"
      : isWindows
        ? (darkAtBoot ? "#171717" : "#f7f7f5")
        : "#f7f7f5",
    transparent: isMac,
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    titleBarStyle: isMac ? "hiddenInset" : isWindows ? "hidden" : "default",
    trafficLightPosition: isMac ? { x: 24, y: 24 } : undefined,
    ...(isWindows
      ? {
          titleBarOverlay: windowsTitleBarColors(),
          backgroundMaterial: "mica",
        }
      : {}),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  applyWindowsTitleBarOverlay(mainWindow);

  const devRendererUrl = trustedDevRendererUrl();
  if (devRendererUrl) {
    mainWindow.loadURL(devRendererUrl.toString());
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
    externalAssistant?.destroy();
    mainWindow = null;
  });
}

function configureWindowsAutoUpdater() {
  // Windows uses the same signed manifest + SHA-256 assisted update flow as
  // macOS. Keep this hook as an explicit no-op so packaged builds never trust
  // electron-builder update metadata as an updater source.
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
  return filters
    .slice(0, MAX_DIALOG_FILTERS)
    .flatMap((filter) => {
      if (
        !isRecord(filter) ||
        typeof filter.name !== "string" ||
        !Array.isArray(filter.extensions)
      )
        return [];
      return [
        {
          name: filter.name.slice(0, 80),
          extensions: filter.extensions
            .filter(
              (extension) =>
                typeof extension === "string" &&
                /^[a-zA-Z0-9]+$/.test(extension),
            )
            .slice(0, MAX_DIALOG_EXTENSIONS),
        },
      ];
    })
    .filter((filter) => filter.extensions.length > 0);
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
    defaultPath:
      typeof safeOptions.defaultPath === "string"
        ? safeOptions.defaultPath
        : undefined,
    filters: normalizeFilters(safeOptions.filters),
  };
}

function hasRendererSourcePath(args) {
  return (
    isRecord(args) &&
    (typeof args.sourcePath === "string" ||
      typeof args.source_path === "string")
  );
}

function assertRendererInvokeAllowed(command, args) {
  if (RENDERER_PATH_COMMANDS.has(command)) {
    throw new Error(`${command} requires a trusted file dialog`);
  }
  if (
    RENDERER_SOURCE_PATH_COMMANDS.has(command) &&
    hasRendererSourcePath(args)
  ) {
    throw new Error(`${command} sourcePath requires a trusted file dialog`);
  }
}

function parentWindowForEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
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
        error:
          error instanceof Error
            ? error.message
            : "failed to create Studio PDF URL",
      };
    }
  });

  ipcMain.on("opennotion:file-src", (event, filePath) => {
    try {
      requireTrustedSender(event);
      if (typeof filePath !== "string" || filePath.trim() === "") {
        throw new Error("file path must be a string");
      }
      event.returnValue = {
        ok: true,
        value: createBackend().fileSrc(filePath),
      };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error:
          error instanceof Error ? error.message : "failed to create file URL",
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
    const args = isRecord(payload.args) ? payload.args : {};
    assertRendererInvokeAllowed(payload.command, args);
    if (payload.command === "download_update_artifact") {
      return await createBackend().invoke(payload.command, {
        ...args,
        onProgress: (progress) => {
          event.sender.send("desktop-update-download-progress", progress);
        },
      });
    }
    return await createBackend().invoke(payload.command, args);
  });

  ipcMain.handle("opennotion:native-theme-source", async (event, themeSource) => {
    requireTrustedSender(event);
    if (!["system", "light", "dark"].includes(themeSource)) {
      throw new Error("invalid native theme source");
    }
    nativeTheme.themeSource = themeSource;
    return null;
  });

  ipcMain.handle("opennotion:dialog-open", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = parentWindowForEvent(event);
    const result = await dialog.showOpenDialog(
      parent,
      normalizeOpenDialogOptions(options),
    );
    if (result.canceled) return null;
    return isRecord(options) && options.multiple === true
      ? result.filePaths
      : result.filePaths[0] || null;
  });

  ipcMain.handle("opennotion:dialog-save", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = parentWindowForEvent(event);
    const result = await dialog.showSaveDialog(
      parent,
      normalizeSaveDialogOptions(options),
    );
    if (result.canceled) return null;
    return result.filePath || null;
  });

  ipcMain.handle("opennotion:backup-export", async (event, options = {}) => {
    requireTrustedSender(event);
    const safeOptions = isRecord(options) ? options : {};
    const result = await dialog.showSaveDialog(
      parentWindowForEvent(event),
      normalizeSaveDialogOptions({
        defaultPath:
          typeof safeOptions.defaultPath === "string"
            ? safeOptions.defaultPath
            : undefined,
        filters: [BACKUP_DIALOG_FILTER],
      }),
    );
    if (result.canceled || !result.filePath) return null;
    return createBackend().exportBackup({
      path: result.filePath,
      exportedAt:
        typeof safeOptions.exportedAt === "string"
          ? safeOptions.exportedAt
          : new Date().toISOString(),
    });
  });

  ipcMain.handle("opennotion:backup-import", async (event, options = {}) => {
    requireTrustedSender(event);
    const safeOptions = isRecord(options) ? options : {};
    const result = await dialog.showOpenDialog(
      parentWindowForEvent(event),
      normalizeOpenDialogOptions({
        multiple: false,
        filters: [BACKUP_DIALOG_FILTER],
      }),
    );
    if (result.canceled || !result.filePaths[0]) return null;
    return createBackend().importBackup({
      path: result.filePaths[0],
      importedAt:
        typeof safeOptions.importedAt === "string"
          ? safeOptions.importedAt
          : new Date().toISOString(),
    });
  });

  ipcMain.handle(
    "opennotion:studio-document-import",
    async (event, options = {}) => {
      requireTrustedSender(event);
      const safeOptions = isRecord(options) ? options : {};
      const result = await dialog.showOpenDialog(
        parentWindowForEvent(event),
        normalizeOpenDialogOptions({
          multiple: false,
          filters: [PDF_DIALOG_FILTER],
        }),
      );
      if (result.canceled || !result.filePaths[0]) return null;
      return await createBackend().importStudioDocument({
        documentId: safeOptions.documentId,
        notePageId: safeOptions.notePageId,
        sourcePath: result.filePaths[0],
        importedAt:
          typeof safeOptions.importedAt === "string"
            ? safeOptions.importedAt
            : new Date().toISOString(),
      });
    },
  );

  ipcMain.handle(
    "opennotion:studio-document-replace-file",
    async (event, options = {}) => {
      requireTrustedSender(event);
      if (
        !isRecord(options) ||
        typeof options.id !== "string" ||
        options.id.trim() === ""
      ) {
        throw new Error("document id is required");
      }
      const result = await dialog.showOpenDialog(
        parentWindowForEvent(event),
        normalizeOpenDialogOptions({
          multiple: false,
          filters: [PDF_DIALOG_FILTER],
        }),
      );
      if (result.canceled || !result.filePaths[0]) return null;
      return await createBackend().replaceStudioDocumentFile({
        id: options.id,
        sourcePath: result.filePaths[0],
        updatedAt:
          typeof options.updatedAt === "string"
            ? options.updatedAt
            : new Date().toISOString(),
      });
    },
  );

  ipcMain.handle(
    "opennotion:cover-image-import",
    async (event, options = {}) => {
      requireTrustedSender(event);
      if (
        !isRecord(options) ||
        typeof options.pageId !== "string" ||
        options.pageId.trim() === ""
      ) {
        throw new Error("page id is required");
      }
      const result = await dialog.showOpenDialog(
        parentWindowForEvent(event),
        normalizeOpenDialogOptions({
          multiple: false,
          filters: [IMAGE_DIALOG_FILTER],
        }),
      );
      if (result.canceled || !result.filePaths[0]) return null;
      return createBackend().importCoverImage({
        pageId: options.pageId,
        sourcePath: result.filePaths[0],
      });
    },
  );

  ipcMain.handle("opennotion:profile-avatar-import", async (event) => {
    requireTrustedSender(event);
    const result = await dialog.showOpenDialog(
      parentWindowForEvent(event),
      normalizeOpenDialogOptions({
        multiple: false,
        filters: [IMAGE_DIALOG_FILTER],
      }),
    );
    if (result.canceled || !result.filePaths[0]) return null;
    return createBackend().importProfileAvatar({
      sourcePath: result.filePaths[0],
    });
  });

  ipcMain.handle(
    "opennotion:editor-media-files-import",
    async (event, options = {}) => {
      requireTrustedSender(event);
      if (
        !isRecord(options) ||
        typeof options.pageId !== "string" ||
        options.pageId.trim() === ""
      ) {
        throw new Error("page id is required");
      }
      const kind = options.kind === "video" ? "video" : "image";
      const result = await dialog.showOpenDialog(
        parentWindowForEvent(event),
        normalizeOpenDialogOptions({
          multiple: true,
          filters: EDITOR_MEDIA_DIALOG_FILTERS[kind],
        }),
      );
      if (result.canceled || result.filePaths.length === 0) return [];
      const backend = createBackend();
      return result.filePaths.map((sourcePath) => {
        const importedPath =
          kind === "video"
            ? backend.importEditorVideo({ pageId: options.pageId, sourcePath })
            : backend.importEditorImage({ pageId: options.pageId, sourcePath });
        return { sourceName: path.basename(sourcePath), path: importedPath };
      });
    },
  );

  // Export/import run dialog + file IO in one round trip so the renderer
  // never passes filesystem paths over IPC: the only paths that reach fs are
  // the ones the user just picked in a native dialog.
  ipcMain.handle("opennotion:export-files", async (event, options = {}) => {
    requireTrustedSender(event);
    if (!isRecord(options) || !Array.isArray(options.files)) {
      throw new Error("invalid export payload");
    }
    const parent = parentWindowForEvent(event);
    const result = await dialog.showSaveDialog(
      parent,
      normalizeSaveDialogOptions(options),
    );
    if (result.canceled || !result.filePath) return null;
    return createBackend().writeExportFiles({
      targetPath: result.filePath,
      files: options.files,
    });
  });

  ipcMain.handle("opennotion:import-page-file", async (event, options = {}) => {
    requireTrustedSender(event);
    const parent = parentWindowForEvent(event);
    const result = await dialog.showOpenDialog(
      parent,
      normalizeOpenDialogOptions(options),
    );
    if (result.canceled || !result.filePaths[0]) return null;
    return createBackend().readImportFile({ path: result.filePaths[0] });
  });

  ipcMain.on("opennotion:auto-update-active", (event) => {
    try {
      requireTrustedSender(event);
      event.returnValue = { ok: true, value: false };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error:
          error instanceof Error ? error.message : "untrusted renderer origin",
      };
    }
  });

  ipcMain.handle("opennotion:install-update-now", (event) => {
    requireTrustedSender(event);
    throw new Error(
      "desktop auto update is disabled; use the signed manifest update flow",
    );
  });
}

configureAppIdentity();
registerIpc();

app.whenReady().then(async () => {
  configureWebAuthn();
  configureApplicationMenu();
  configureAppProtocol();
  createBackend();
  await startStudioPdfServer();
  createMainWindow();
  nativeTheme.on("updated", () => {
    if (mainWindow) applyWindowsTitleBarOverlay(mainWindow);
  });
  externalAssistant = createExternalAssistantController({
    getMainWindow: () => mainWindow,
    backend: createBackend(),
  });
  externalAssistant.init();
  configureWindowsAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  externalAssistant?.destroy();
  externalAssistant = null;
  studioPdfServer?.close();
  studioPdfServer = null;
  studioPdfServerOrigin = null;
  studioPdfPort = null;
  studioPdfAccessToken = null;
  if (backend) backend.close();
  backend = null;
});
