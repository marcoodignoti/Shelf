const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync } = require("node:sqlite");

const APP_SCHEMA_VERSION = "1";
const APP_ASSET_PROTOCOL = "opennotion-app";
const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const STUDIO_PDF_MAX_BYTES = 512 * 1024 * 1024;
const UPDATE_MANIFEST_MAX_BYTES = 64 * 1024;
const UPDATE_ARTIFACT_MAX_BYTES = 512 * 1024 * 1024;
const UPDATE_SIGNATURE_ALGORITHM = "ed25519";
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const BACKUP_MAX_PAGES = 5000;
const BACKUP_MAX_ID_LENGTH = 512;
const BACKUP_MAX_TITLE_LENGTH = 512;
const BACKUP_MAX_TEXT_LENGTH = 1024 * 1024;
const BACKUP_MAX_METADATA_LENGTH = 1024 * 1024;
const BACKUP_MAX_ICON_LENGTH = 512;
const BACKUP_MAX_COVER_URL_LENGTH = 4096;
const UPDATE_MANIFEST_URLS = new Set([
  "https://github.com/marcoodignoti/OpenNotion/releases/download/beta/beta-update.json",
  "https://github.com/marcoodignoti/OpenNotion/releases/latest/download/beta-update.json",
]);
const UPDATE_DOWNLOAD_URL_PATTERN =
  /^https:\/\/github\.com\/marcoodignoti\/OpenNotion\/releases\/download\/[^/]+\/OpenNotion_[^/]+\.(dmg|zip|exe)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_UPDATE_PUBLIC_KEY_PATH = path.join(__dirname, "update-public-key.pem");

const PAGE_COLUMNS =
  "id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at";
const STUDIO_DOCUMENT_COLUMNS =
  "id, title, original_filename, stored_file_path, note_page_id, project_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at";
const STUDIO_PROJECT_COLUMNS = "id, name, parent_id, sort_order, created_at, updated_at";
const STUDIO_DOCUMENT_PAGE_LINK_COLUMNS = "id, document_id, page_id, pdf_page, label, sort_order, created_at, updated_at";

function ensurePrivateDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(directoryPath, 0o700);
  }
}

function hasColumn(db, table, column) {
  return db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).some((row) => row.name === column);
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      title TEXT,
      parent_id TEXT,
      content TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`
    INSERT INTO app_metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(APP_SCHEMA_VERSION);

  const pageColumns = db.prepare("SELECT name FROM pragma_table_info('pages')").all().map((row) => row.name);
  const addPageColumn = (column, sql) => {
    if (!pageColumns.includes(column)) db.exec(sql);
  };

  addPageColumn("cover_url", "ALTER TABLE pages ADD COLUMN cover_url TEXT");
  if (!pageColumns.includes("search_text")) {
    db.exec("ALTER TABLE pages ADD COLUMN search_text TEXT");
    db.exec("UPDATE pages SET search_text = content WHERE search_text IS NULL");
  }
  addPageColumn("is_deleted", "ALTER TABLE pages ADD COLUMN is_deleted INTEGER DEFAULT 0");
  addPageColumn("is_favorite", "ALTER TABLE pages ADD COLUMN is_favorite INTEGER DEFAULT 0");
  if (!pageColumns.includes("sort_order")) {
    db.exec("ALTER TABLE pages ADD COLUMN sort_order INTEGER DEFAULT 0");
    db.exec("UPDATE pages SET sort_order = rowid WHERE sort_order = 0");
  }
  addPageColumn("is_template", "ALTER TABLE pages ADD COLUMN is_template INTEGER DEFAULT 0");
  addPageColumn("is_database", "ALTER TABLE pages ADD COLUMN is_database INTEGER DEFAULT 0");
  addPageColumn("database_schema", "ALTER TABLE pages ADD COLUMN database_schema TEXT");
  addPageColumn("properties", "ALTER TABLE pages ADD COLUMN properties TEXT");
  addPageColumn("page_kind", "ALTER TABLE pages ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'note'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_file_path TEXT NOT NULL,
      note_page_id TEXT NOT NULL UNIQUE,
      project_id TEXT,
      last_opened_at TEXT NOT NULL,
      viewer_zoom INTEGER NOT NULL DEFAULT 100,
      viewer_page INTEGER NOT NULL DEFAULT 1,
      panel_layout TEXT NOT NULL DEFAULT 'pdf-left',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_document_page_links (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      pdf_page INTEGER,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(document_id, page_id)
    );
  `);

  if (!hasColumn(db, "studio_documents", "project_id")) {
    db.exec("ALTER TABLE studio_documents ADD COLUMN project_id TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_studio_documents_last_opened
      ON studio_documents (last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_studio_documents_project
      ON studio_documents (project_id, last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_studio_projects_parent_sort
      ON studio_projects (parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_studio_document_page_links_document
      ON studio_document_page_links (document_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_studio_document_page_links_page
      ON studio_document_page_links (page_id);
    CREATE INDEX IF NOT EXISTS idx_pages_active_parent_sort
      ON pages (is_deleted, parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_pages_active_updated_at
      ON pages (is_deleted, updated_at);
  `);

  db.exec(`
    INSERT OR IGNORE INTO studio_document_page_links (
      id, document_id, page_id, pdf_page, label, sort_order, created_at, updated_at
    )
    SELECT lower(hex(randomblob(16))), id, note_page_id, NULL, 'Primary note', 0, created_at, updated_at
    FROM studio_documents
  `);
}

function openDatabase(appConfigDir) {
  ensurePrivateDirectory(appConfigDir);
  const dbPath = path.join(appConfigDir, "opennotion.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  runMigrations(db);
  return db;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeOptionalString(value) {
  return value === undefined ? null : value;
}

function rowValue(row, key, fallback = 0) {
  return row && row[key] !== undefined ? row[key] : fallback;
}

function lowerLikePattern(query) {
  return `%${query.trim().toLowerCase()}%`;
}

function validateJsonPath(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".json") {
    throw new Error("backup file must be a JSON file");
  }
}

function validateBackupImportSource(filePath) {
  validateJsonPath(filePath);
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error("backup path must be a file");
  if (stats.size > BACKUP_MAX_BYTES) throw new Error("Backup file is too large");
}

function validateBackupExportDestination(filePath) {
  validateJsonPath(filePath);
  const parent = path.dirname(filePath);
  if (!fs.statSync(parent).isDirectory()) {
    throw new Error("backup destination parent must be a directory");
  }
}

function validateOptionalStringLength(field, value, maxLength) {
  if (value !== null && value !== undefined && String(value).length > maxLength) {
    throw new Error(`backup field ${field} is too large`);
  }
}

function normalizeImportedCoverUrl(value) {
  if (value === null || value === undefined) return null;
  const coverUrl = String(value).trim();
  if (!coverUrl) return null;
  if (/^https:\/\//i.test(coverUrl)) return coverUrl;
  if (/^blob:/i.test(coverUrl)) return coverUrl;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(coverUrl)) return coverUrl;
  return null;
}

const IMPORTED_MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file"]);

function sanitizeImportedBlockMedia(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return block;
  const next = { ...block };
  if (
    IMPORTED_MEDIA_BLOCK_TYPES.has(next.type) &&
    next.props &&
    typeof next.props === "object" &&
    !Array.isArray(next.props)
  ) {
    next.props = { ...next.props };
    if (typeof next.props.url === "string" && /^file:\/\//i.test(next.props.url)) {
      delete next.props.url;
    }
  }
  if (Array.isArray(next.children)) {
    next.children = next.children.map(sanitizeImportedBlockMedia);
  }
  return next;
}

function sanitizeImportedPageContent(value) {
  if (typeof value !== "string" || value.trim() === "") return value;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return value;
    return JSON.stringify(parsed.map(sanitizeImportedBlockMedia));
  } catch {
    return value;
  }
}

function sanitizeImportedPageRecord(page) {
  return {
    ...page,
    content: sanitizeImportedPageContent(page.content),
    cover_url: normalizeImportedCoverUrl(page.cover_url),
    page_kind: page.page_kind === "studio_note" ? "studio_note" : "note",
  };
}

function validateImportedPage(page) {
  if (typeof page !== "object" || page === null || Array.isArray(page)) {
    throw new Error("Backup file has invalid pages");
  }
  if (String(page.id ?? "").length > BACKUP_MAX_ID_LENGTH) throw new Error("backup field id is too large");
  if (String(page.title ?? "").length > BACKUP_MAX_TITLE_LENGTH) throw new Error("backup field title is too large");
  validateOptionalStringLength("parent_id", page.parent_id, BACKUP_MAX_ID_LENGTH);
  validateOptionalStringLength("content", page.content, BACKUP_MAX_TEXT_LENGTH);
  validateOptionalStringLength("search_text", page.search_text, BACKUP_MAX_TEXT_LENGTH);
  validateOptionalStringLength("icon", page.icon, BACKUP_MAX_ICON_LENGTH);
  validateOptionalStringLength("cover_url", page.cover_url, BACKUP_MAX_COVER_URL_LENGTH);
  validateOptionalStringLength("database_schema", page.database_schema, BACKUP_MAX_METADATA_LENGTH);
  validateOptionalStringLength("properties", page.properties, BACKUP_MAX_METADATA_LENGTH);
}

function readImportedBackup(filePath) {
  validateBackupImportSource(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES) {
    throw new Error("Backup file is too large");
  }

  let backup;
  try {
    backup = JSON.parse(raw);
  } catch {
    throw new Error("Backup file is not valid JSON");
  }

  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("Backup file has invalid shape");
  }
  if (backup.version !== 1) throw new Error("Backup file version is not supported");
  if (typeof backup.exported_at !== "string" || backup.exported_at.length > BACKUP_MAX_TITLE_LENGTH) {
    throw new Error("Backup file has invalid export timestamp");
  }
  if (!Array.isArray(backup.pages) || backup.pages.length > BACKUP_MAX_PAGES) {
    throw new Error("Backup file has too many pages");
  }
  backup.pages.forEach(validateImportedPage);
  return backup;
}

function prepareImportedBackupPages(pages, importedAt) {
  const idMap = new Map();
  pages.forEach((page, index) => {
    idMap.set(page.id, `${crypto.randomUUID()}-${index + 1}`);
  });

  return pages.map((page) => ({
    ...sanitizeImportedPageRecord(page),
    id: idMap.get(page.id) || page.id,
    parent_id: page.parent_id ? idMap.get(page.parent_id) ?? null : null,
    is_deleted: 0,
    is_template: 0,
    created_at: importedAt,
    updated_at: importedAt,
  }));
}

function allowedCoverExtension(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (extension === "jpeg") return "jpg";
  if (["jpg", "png", "webp", "gif"].includes(extension)) return extension;
  return null;
}

function coverExtensionFromMagic(bytes) {
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"))) {
    return "webp";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a"))) return "gif";
  return null;
}

function validatedPdfFile(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".pdf") throw new Error("file must be a PDF");
  const stats = fs.statSync(filePath);
  if (stats.size > STUDIO_PDF_MAX_BYTES) throw new Error("PDF must be 512 MB or smaller");
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, header, 0, 5, 0);
    if (bytesRead < 5 || !header.equals(Buffer.from("%PDF-"))) {
      throw new Error("PDF content is not valid");
    }
  } finally {
    fs.closeSync(fd);
  }
}

function safeStorageId(id) {
  const safeId = String(id ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  return safeId || "document";
}

function safeFileStem(fileName) {
  const parsed = path.parse(fileName || "image");
  const safeName = parsed.name.replace(/[^a-zA-Z0-9_-]/g, "");
  return safeName || "image";
}

function validatedCoverExtension(filePath, maxBytes) {
  const extension = allowedCoverExtension(filePath);
  if (!extension) throw new Error("cover image must be PNG, JPG, WebP, or GIF");
  const stats = fs.statSync(filePath);
  if (stats.size > maxBytes) throw new Error("cover image must be 10 MB or smaller");
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    const detected = coverExtensionFromMagic(header.subarray(0, bytesRead));
    if (!detected) throw new Error("cover image content is not a supported image");
    if (detected !== extension) throw new Error("cover image content does not match its extension");
    return extension;
  } finally {
    fs.closeSync(fd);
  }
}

function validatedEditorImageExtension(fileName, bytes) {
  if (bytes.length > COVER_IMAGE_MAX_BYTES) throw new Error("image must be 10 MB or smaller");
  const extension = allowedCoverExtension(fileName);
  if (!extension) throw new Error("image must be PNG, JPG, WebP, or GIF");
  const detected = coverExtensionFromMagic(bytes);
  if (!detected) throw new Error("image content is not a supported image");
  if (detected !== extension) throw new Error("image content does not match its extension");
  return extension;
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateManagedStudioDocumentPath(storedFilePath, studioDocumentsRoot) {
  const canonicalPath = fs.realpathSync(storedFilePath);
  const canonicalRoot = fs.realpathSync(studioDocumentsRoot);
  const expected = path.basename(canonicalPath) === "source.pdf" && isPathInside(canonicalRoot, canonicalPath);
  if (!expected) throw new Error("stored Studio document path is outside app storage");
  return canonicalPath;
}

function validateManagedAssetPath(filePath, appConfigDir) {
  const canonicalPath = fs.realpathSync(filePath);
  const roots = ["covers", "editor-images", "studio-documents"]
    .map((directory) => path.join(appConfigDir, directory))
    .filter((directory) => fs.existsSync(directory))
    .map((directory) => fs.realpathSync(directory));
  if (!roots.some((root) => isPathInside(root, canonicalPath))) {
    throw new Error("file path is outside app-managed storage");
  }
  return canonicalPath;
}

function encodeAppAssetPath(filePath) {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

function decodeAppAssetPath(token) {
  const encoded = String(token ?? "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(encoded)) {
    throw new Error("asset URL token is invalid");
  }
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  if (!decoded) throw new Error("asset URL token is invalid");
  return decoded;
}

function normalizePem(value) {
  return String(value ?? "").replace(/\\n/g, "\n").trim();
}

function updateManifestPublicKey(configuredKey) {
  if (configuredKey) return normalizePem(configuredKey);
  if (process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PATH) {
    return normalizePem(fs.readFileSync(path.resolve(process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PATH), "utf8"));
  }
  if (process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PEM) {
    return normalizePem(process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PEM);
  }
  return normalizePem(fs.readFileSync(DEFAULT_UPDATE_PUBLIC_KEY_PATH, "utf8"));
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Update manifest contains unsupported data");
}

function signedManifestPayload(value, publicKeyPem) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid signed update manifest");
  }

  const envelope = value;
  if (envelope.signatureAlgorithm !== UPDATE_SIGNATURE_ALGORITHM) {
    throw new Error("Invalid update manifest signature algorithm");
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new Error("Invalid signed update manifest payload");
  }
  if (typeof envelope.signature !== "string" || !envelope.signature.trim()) {
    throw new Error("Invalid update manifest signature");
  }

  const payloadBytes = Buffer.from(canonicalJson(envelope.payload), "utf8");
  const signature = Buffer.from(envelope.signature, "base64");
  const verified = crypto.verify(null, payloadBytes, crypto.createPublicKey(publicKeyPem), signature);
  if (!verified) throw new Error("Update manifest signature verification failed");
  return envelope.payload;
}

function updateArtifactFileName(parsedUrl) {
  const fileName = decodeURIComponent(path.basename(parsedUrl.pathname));
  if (!/^OpenNotion_[a-zA-Z0-9._-]+\.(dmg|zip|exe)$/i.test(fileName)) {
    throw new Error("update artifact filename is not trusted");
  }
  return fileName;
}

function removeStoredStudioDocumentFile(storedFilePath, studioDocumentsRoot) {
  if (!fs.existsSync(storedFilePath)) return;
  const storedPath = validateManagedStudioDocumentPath(storedFilePath, studioDocumentsRoot);
  fs.rmSync(storedPath, { force: true });
  fs.rmSync(path.dirname(storedPath), { recursive: true, force: true });
}

class OpenNotionBackend {
  constructor({ appConfigDir, downloadsDir, openPath, revealPath, openExternalUrl, updateManifestPublicKey: publicKey }) {
    this.appConfigDir = appConfigDir;
    this.downloadsDir = downloadsDir || path.join(appConfigDir, "downloads");
    this.updateManifestPublicKey = updateManifestPublicKey(publicKey);
    this.db = openDatabase(appConfigDir);
    this.openPath = openPath || (() => Promise.resolve(""));
    this.revealPath = revealPath || (() => {});
    this.openExternal = openExternalUrl || (() => Promise.resolve(""));
    this.commands = {
      list_pages: () => this.listPages(),
      list_all_pages: () => this.listAllPages(),
      export_backup: (args) => this.exportBackup(args),
      import_backup: (args) => this.importBackup(args),
      search_pages: (args) => this.searchPages(args),
      get_page: (args) => this.getPage(args),
      create_page: (args) => this.createPage(args),
      update_page: (args) => this.updatePage(args),
      delete_page: (args) => this.deletePage(args),
      move_page: (args) => this.movePage(args),
      reorder_pages: (args) => this.reorderPages(args),
      import_pages: (args) => this.importPages(args),
      list_studio_documents: () => this.listStudioDocuments(),
      list_studio_projects: () => this.listStudioProjects(),
      create_studio_project: (args) => this.createStudioProject(args),
      rename_studio_project: (args) => this.renameStudioProject(args),
      update_studio_project_parent: (args) => this.updateStudioProjectParent(args),
      delete_studio_project: (args) => this.deleteStudioProject(args),
      update_studio_document_project: (args) => this.updateStudioDocumentProject(args),
      list_all_studio_document_page_links: () => this.listAllStudioDocumentPageLinks(),
      list_studio_document_page_links: (args) => this.listStudioDocumentPageLinks(args),
      link_studio_document_page: (args) => this.linkStudioDocumentPage(args),
      update_studio_document_page_link: (args) => this.updateStudioDocumentPageLink(args),
      unlink_studio_document_page: (args) => this.unlinkStudioDocumentPage(args),
      import_studio_document: (args) => this.importStudioDocument(args),
      replace_studio_document_file: (args) => this.replaceStudioDocumentFile(args),
      update_studio_document_viewer_state: (args) => this.updateStudioDocumentViewerState(args),
      rename_studio_document: (args) => this.renameStudioDocument(args),
      open_studio_document_file: (args) => this.openStudioDocumentFile(args),
      reveal_studio_document_file: (args) => this.revealStudioDocumentFile(args),
      delete_studio_document: (args) => this.deleteStudioDocument(args),
      toggle_favorite: (args) => this.toggleFavorite(args),
      toggle_template: (args) => this.toggleTemplate(args),
      create_page_from_template: (args) => this.createPageFromTemplate(args),
      duplicate_page: (args) => this.duplicatePage(args),
      import_cover_image: (args) => this.importCoverImage(args),
      import_editor_image: (args) => this.importEditorImage(args),
      open_external_url: (args) => this.openExternalUrl(args),
      fetch_update_manifest: (args) => this.fetchUpdateManifest(args),
      download_update_artifact: (args) => this.downloadUpdateArtifact(args),
      show_character_palette: () => null,
    };
  }

  async invoke(command, args = {}) {
    const handler = this.commands[command];
    if (!handler) throw new Error(`unknown command: ${command}`);
    return await handler(args || {});
  }

  close() {
    this.db.close();
  }

  withTransaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failure; original error is more useful.
      }
      throw error;
    }
  }

  fileSrc(filePath) {
    const canonicalPath = validateManagedAssetPath(filePath, this.appConfigDir);
    return `${APP_ASSET_PROTOCOL}://asset/${encodeAppAssetPath(canonicalPath)}`;
  }

  resolveManagedAssetPath(assetPathToken) {
    return validateManagedAssetPath(decodeAppAssetPath(assetPathToken), this.appConfigDir);
  }

  async openExternalUrl({ url }) {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:") throw new Error("external URL must use HTTPS");
    const error = await this.openExternal(parsed.toString());
    if (error) throw new Error(error);
  }

  async fetchUpdateManifest({ url }) {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:") throw new Error("update manifest URL must use HTTPS");
    if (!UPDATE_MANIFEST_URLS.has(parsed.toString())) {
      throw new Error("update manifest URL is not trusted");
    }

    const response = await fetch(parsed.toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`Update check failed (${response.status})`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
    if (Number.isFinite(contentLength) && contentLength > UPDATE_MANIFEST_MAX_BYTES) {
      throw new Error("Update manifest is too large");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > UPDATE_MANIFEST_MAX_BYTES) {
      throw new Error("Update manifest is too large");
    }

    let signedManifest;
    try {
      signedManifest = JSON.parse(text);
    } catch {
      throw new Error("Invalid signed update manifest");
    }
    return signedManifestPayload(signedManifest, this.updateManifestPublicKey);
  }

  async downloadUpdateArtifact({ url, sha256 }) {
    const parsed = new URL(String(url ?? ""));
    const expectedSha256 = String(sha256 ?? "").trim().toLowerCase();
    if (!UPDATE_DOWNLOAD_URL_PATTERN.test(parsed.toString())) {
      throw new Error("update download URL is not trusted");
    }
    if (!SHA256_PATTERN.test(expectedSha256)) {
      throw new Error("update checksum is invalid");
    }

    const fileName = updateArtifactFileName(parsed);
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    const finalPath = path.join(this.downloadsDir, fileName);
    const tempPath = path.join(this.downloadsDir, `.${fileName}.${process.pid}.${Date.now()}.download`);

    try {
      const response = await fetch(parsed.toString(), {
        headers: { accept: "application/octet-stream" },
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`Update download failed (${response.status})`);
      if (!response.body) throw new Error("Update download response is empty");

      const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
      if (Number.isFinite(contentLength) && contentLength > UPDATE_ARTIFACT_MAX_BYTES) {
        throw new Error("Update download is too large");
      }

      const hash = crypto.createHash("sha256");
      let bytes = 0;

      await pipeline(
        Readable.fromWeb(response.body),
        async function* verifyChunks(source) {
          for await (const chunk of source) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > UPDATE_ARTIFACT_MAX_BYTES) throw new Error("Update download is too large");
            hash.update(buffer);
            yield buffer;
          }
        },
        fs.createWriteStream(tempPath, { flags: "w" })
      );

      const actualSha256 = hash.digest("hex");
      if (actualSha256 !== expectedSha256) {
        throw new Error("Update download checksum mismatch");
      }

      fs.rmSync(finalPath, { force: true });
      fs.renameSync(tempPath, finalPath);
      const error = await this.openPath(finalPath);
      if (error) throw new Error(error);
      return { path: finalPath, bytes, sha256: actualSha256 };
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  listPages() {
    return this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE is_deleted = 0 AND page_kind IN ('note', 'studio_note') ORDER BY sort_order ASC, created_at DESC`).all();
  }

  listAllPages() {
    return this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages ORDER BY sort_order ASC, created_at DESC`).all();
  }

  searchPages({ query }) {
    const trimmed = String(query ?? "").trim();
    if (!trimmed) return [];
    const pattern = lowerLikePattern(trimmed);
    return this.db.prepare(`
      SELECT ${PAGE_COLUMNS},
        CASE
          WHEN lower(coalesce(search_text, '')) LIKE ? THEN search_text
          ELSE NULL
        END AS matched_content
      FROM pages
      WHERE is_deleted = 0
        AND page_kind IN ('note', 'studio_note')
        AND (lower(coalesce(title, '')) LIKE ? OR lower(coalesce(search_text, '')) LIKE ?)
      ORDER BY
        CASE WHEN lower(coalesce(title, '')) LIKE ? THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 50
    `).all(pattern, pattern, pattern, pattern);
  }

  getPage({ id }) {
    return this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`).get(id) || null;
  }

  createPage({ id, title, parentId, parent_id, createdAt, created_at }) {
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `).get(parent, parent), "value");

    this.db.prepare(`
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'note', ?, ?)
    `).run(id, title, parent, sortOrder, created, created);
    return this.getPage({ id });
  }

  updatePage({ id, updates, updatedAt, updated_at }) {
    const updated = updatedAt ?? updated_at;
    this.withTransaction(() => {
      const apply = (column, value) => {
        this.db.prepare(`UPDATE pages SET ${column} = ?, updated_at = ? WHERE id = ?`).run(value, updated, id);
      };
      if (own(updates, "title")) apply("title", updates.title);
      if (own(updates, "parent_id")) apply("parent_id", updates.parent_id);
      if (own(updates, "content")) {
        const searchText = own(updates, "search_text") ? updates.search_text : updates.content;
        this.db.prepare("UPDATE pages SET content = ?, search_text = ?, updated_at = ? WHERE id = ?")
          .run(updates.content, searchText, updated, id);
      }
      if (own(updates, "icon")) apply("icon", updates.icon);
      if (own(updates, "cover_url")) apply("cover_url", updates.cover_url);
      if (own(updates, "is_deleted")) apply("is_deleted", updates.is_deleted);
      if (own(updates, "is_favorite")) apply("is_favorite", updates.is_favorite);
      if (own(updates, "is_template")) apply("is_template", updates.is_template);
      if (own(updates, "is_database")) apply("is_database", updates.is_database);
      if (own(updates, "database_schema")) apply("database_schema", updates.database_schema);
      if (own(updates, "properties")) apply("properties", updates.properties);
      if (own(updates, "page_kind")) apply("page_kind", updates.page_kind);
    });
  }

  deletePage({ id }) {
    this.withTransaction(() => {
      this.db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        DELETE FROM studio_document_page_links
        WHERE page_id IN (SELECT id FROM descendants)
      `).run(id);
      this.db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        DELETE FROM pages
        WHERE id IN (SELECT id FROM descendants)
      `).run(id);
    });
  }

  movePage({ id, parentId, parent_id, updatedAt, updated_at }) {
    const parent = parentId ?? parent_id ?? null;
    const updated = updatedAt ?? updated_at;
    if (parent) {
      if (parent === id) throw new Error("page cannot be moved under itself");
      const parentExists = this.db.prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0").get(parent);
      if (!parentExists) throw new Error("target parent page does not exist");
      const descendantMatch = this.db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE parent_id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        SELECT id FROM descendants WHERE id = ? LIMIT 1
      `).get(id, parent);
      if (descendantMatch) throw new Error("page cannot be moved under one of its descendants");
    }
    const result = this.db.prepare("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?").run(parent, updated, id);
    if (result.changes === 0) throw new Error("page does not exist");
  }

  reorderPages({ parentId, parent_id, orderedIds, ordered_ids, updatedAt, updated_at }) {
    const parent = parentId ?? parent_id ?? null;
    const ordered = orderedIds ?? ordered_ids ?? [];
    const updated = updatedAt ?? updated_at;
    if (ordered.length === 0) return;
    this.withTransaction(() => {
      ordered.forEach((id, index) => {
        const result = this.db.prepare(`
          UPDATE pages
          SET sort_order = ?, updated_at = ?
          WHERE id = ?
            AND is_deleted = 0
            AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
        `).run(index, updated, id, parent, parent);
        if (result.changes === 0) throw new Error("page order contains invalid page");
      });
    });
  }

  importPages({ pages }) {
    return this.importPageRecords(pages || []);
  }

  importPageRecords(pages) {
    let importedCount = 0;
    this.withTransaction(() => {
      const insert = this.db.prepare(`
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const page of pages) {
        const sanitizedPage = sanitizeImportedPageRecord(page);
        importedCount += insert.run(
          sanitizedPage.id,
          sanitizedPage.title,
          normalizeOptionalString(sanitizedPage.parent_id),
          normalizeOptionalString(sanitizedPage.content),
          normalizeOptionalString(sanitizedPage.search_text),
          normalizeOptionalString(sanitizedPage.icon),
          normalizeOptionalString(sanitizedPage.cover_url),
          sanitizedPage.is_deleted,
          sanitizedPage.is_favorite,
          sanitizedPage.is_template ?? 0,
          sanitizedPage.is_database ?? 0,
          normalizeOptionalString(sanitizedPage.database_schema),
          normalizeOptionalString(sanitizedPage.properties),
          sanitizedPage.sort_order ?? 0,
          sanitizedPage.page_kind,
          sanitizedPage.created_at,
          sanitizedPage.updated_at
        ).changes;
      }
    });
    return importedCount;
  }

  exportBackup({ path: filePath, exportedAt, exported_at }) {
    const exported = exportedAt ?? exported_at;
    validateBackupExportDestination(filePath);
    const pages = this.listAllPages();
    const raw = JSON.stringify({ version: 1, exported_at: exported, pages }, null, 2);
    if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES) throw new Error("Backup export is too large");
    fs.writeFileSync(filePath, raw);
    return pages.length;
  }

  importBackup({ path: filePath, importedAt, imported_at }) {
    const imported = importedAt ?? imported_at;
    const backup = readImportedBackup(filePath);
    return this.importPageRecords(prepareImportedBackupPages(backup.pages, imported));
  }

  listStudioDocuments() {
    return this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents ORDER BY last_opened_at DESC, created_at DESC`).all();
  }

  listStudioProjects() {
    return this.db.prepare(`SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects ORDER BY sort_order ASC, name ASC`).all();
  }

  createStudioProject({ id, name, parentId, parent_id, createdAt, created_at }) {
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("project name cannot be empty");
    if (parent) {
      const count = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?").get(parent), "value");
      if (count === 0) throw new Error("parent project not found");
    }
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_projects
      WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
    `).get(parent, parent), "value");
    this.db.prepare("INSERT INTO studio_projects (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, trimmed, parent, sortOrder, created, created);
    return this.db.prepare(`SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects WHERE id = ?`).get(id);
  }

  renameStudioProject({ id, name, updatedAt, updated_at }) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("project name cannot be empty");
    const result = this.db.prepare("UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ?").run(trimmed, updatedAt ?? updated_at, id);
    if (result.changes === 0) throw new Error("project not found");
  }

  updateStudioProjectParent({ id, parentId, parent_id, updatedAt, updated_at }) {
    const parent = parentId ?? parent_id ?? null;
    const updated = updatedAt ?? updated_at;
    if (parent === id) throw new Error("project cannot be its own parent");
    if (parent) {
      const parentExists = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?").get(parent), "value");
      if (parentExists === 0) throw new Error("parent project not found");
      const wouldCycle = rowValue(this.db.prepare(`
        WITH RECURSIVE ancestors(id, parent_id) AS (
          SELECT id, parent_id FROM studio_projects WHERE id = ?
          UNION ALL
          SELECT studio_projects.id, studio_projects.parent_id
          FROM studio_projects
          INNER JOIN ancestors ON studio_projects.id = ancestors.parent_id
        )
        SELECT COUNT(*) AS value FROM ancestors WHERE id = ?
      `).get(parent, id), "value");
      if (wouldCycle > 0) throw new Error("project cycle not allowed");
    }
    const projectExists = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?").get(id), "value");
    if (projectExists === 0) throw new Error("project not found");
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_projects
      WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
    `).get(parent, parent), "value");
    const result = this.db.prepare("UPDATE studio_projects SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?")
      .run(parent, sortOrder, updated, id);
    if (result.changes === 0) throw new Error("project not found");
  }

  deleteStudioProject({ id, updatedAt, updated_at }) {
    const updated = updatedAt ?? updated_at;
    let deleted = 0;
    this.withTransaction(() => {
      this.db.prepare("UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ?").run(updated, id);
      this.db.prepare("UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?").run(updated, id);
      deleted = this.db.prepare("DELETE FROM studio_projects WHERE id = ?").run(id).changes;
    });
    if (deleted === 0) throw new Error("project not found");
  }

  updateStudioDocumentProject({ id, projectId, project_id, updatedAt, updated_at }) {
    const project = projectId ?? project_id ?? null;
    if (project) {
      const projectExists = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?").get(project), "value");
      if (projectExists === 0) throw new Error("project not found");
    }
    const result = this.db.prepare("UPDATE studio_documents SET project_id = ?, updated_at = ? WHERE id = ?")
      .run(project, updatedAt ?? updated_at, id);
    if (result.changes === 0) throw new Error("document not found");
  }

  studioDocumentPageLinkFromRow(row) {
    if (!row) return null;
    return {
      id: row.link_id,
      document_id: row.document_id,
      page_id: row.page_id,
      pdf_page: row.pdf_page,
      label: row.label,
      sort_order: row.link_sort_order,
      created_at: row.link_created_at,
      updated_at: row.link_updated_at,
      page: {
        id: row.page_id,
        title: row.title,
        parent_id: row.parent_id,
        content: row.content,
        search_text: row.search_text,
        icon: row.icon,
        cover_url: row.cover_url,
        is_deleted: row.is_deleted,
        is_favorite: row.is_favorite,
        is_template: row.is_template,
        is_database: row.is_database,
        database_schema: row.database_schema,
        properties: row.properties,
        sort_order: row.page_sort_order,
        page_kind: row.page_kind,
        created_at: row.page_created_at,
        updated_at: row.page_updated_at,
      },
    };
  }

  studioDocumentPageLinkSelectSql() {
    return `
      SELECT
        links.id AS link_id,
        links.document_id,
        links.page_id,
        links.pdf_page,
        links.label,
        links.sort_order AS link_sort_order,
        links.created_at AS link_created_at,
        links.updated_at AS link_updated_at,
        pages.id AS page_id,
        pages.title,
        pages.parent_id,
        pages.content,
        pages.search_text,
        pages.icon,
        pages.cover_url,
        pages.is_deleted,
        pages.is_favorite,
        pages.is_template,
        pages.is_database,
        pages.database_schema,
        pages.properties,
        pages.sort_order AS page_sort_order,
        pages.page_kind,
        pages.created_at AS page_created_at,
        pages.updated_at AS page_updated_at
      FROM studio_document_page_links links
      JOIN pages ON pages.id = links.page_id
    `;
  }

  listStudioDocumentPageLinks({ documentId, document_id }) {
    const document = documentId ?? document_id;
    return this.db.prepare(`
      ${this.studioDocumentPageLinkSelectSql()}
      WHERE links.document_id = ?
        AND pages.is_deleted = 0
      ORDER BY links.sort_order ASC, links.created_at ASC
    `).all(document).map((row) => this.studioDocumentPageLinkFromRow(row));
  }

  listAllStudioDocumentPageLinks() {
    return this.db.prepare(`
      ${this.studioDocumentPageLinkSelectSql()}
      JOIN studio_documents documents ON documents.id = links.document_id
      WHERE pages.is_deleted = 0
      ORDER BY documents.title COLLATE NOCASE ASC, links.sort_order ASC, links.created_at ASC
    `).all().map((row) => this.studioDocumentPageLinkFromRow(row));
  }

  linkStudioDocumentPage({ id, documentId, document_id, pageId, page_id, pdfPage, pdf_page, label, createdAt, created_at }) {
    const linkId = id || crypto.randomUUID();
    const document = documentId ?? document_id;
    const page = pageId ?? page_id;
    const created = createdAt ?? created_at;
    const pdfPageValue = Number.isFinite(Number(pdfPage ?? pdf_page)) ? Math.max(1, Math.round(Number(pdfPage ?? pdf_page))) : null;
    const labelValue = normalizeOptionalString(label);
    const documentExists = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM studio_documents WHERE id = ?").get(document), "value");
    if (documentExists === 0) throw new Error("document not found");
    const pageExists = rowValue(this.db.prepare("SELECT COUNT(*) AS value FROM pages WHERE id = ? AND is_deleted = 0").get(page), "value");
    if (pageExists === 0) throw new Error("page not found");
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_document_page_links
      WHERE document_id = ?
    `).get(document), "value");

    this.db.prepare(`
      INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, page_id) DO UPDATE SET
        pdf_page = excluded.pdf_page,
        label = excluded.label,
        updated_at = excluded.updated_at
    `).run(linkId, document, page, pdfPageValue, labelValue, sortOrder, created, created);

    const row = this.db.prepare(`
      ${this.studioDocumentPageLinkSelectSql()}
      WHERE links.document_id = ?
        AND links.page_id = ?
        AND pages.is_deleted = 0
    `).get(document, page);
    return this.studioDocumentPageLinkFromRow(row);
  }

  updateStudioDocumentPageLink({ id, pdfPage, pdf_page, label, updatedAt, updated_at }) {
    const pdfPageInput = pdfPage ?? pdf_page;
    const pdfPageValue = pdfPageInput === null || pdfPageInput === undefined || pdfPageInput === ""
      ? null
      : Math.max(1, Math.round(Number(pdfPageInput)));
    if (pdfPageValue !== null && !Number.isFinite(pdfPageValue)) throw new Error("invalid PDF page");
    const result = this.db.prepare(`
      UPDATE studio_document_page_links
      SET pdf_page = ?, label = ?, updated_at = ?
      WHERE id = ?
    `).run(pdfPageValue, normalizeOptionalString(label), updatedAt ?? updated_at, id);
    if (result.changes === 0) throw new Error("link not found");
  }

  unlinkStudioDocumentPage({ id }) {
    this.db.prepare("DELETE FROM studio_document_page_links WHERE id = ?").run(id);
  }

  studioPdfDestination(documentId) {
    const directory = path.join(this.appConfigDir, "studio-documents", safeStorageId(documentId));
    ensurePrivateDirectory(directory);
    return path.join(directory, "source.pdf");
  }

  async importStudioDocument({ documentId, document_id, notePageId, note_page_id, sourcePath, source_path, importedAt, imported_at }) {
    const documentIdValue = documentId ?? document_id;
    const notePageIdValue = notePageId ?? note_page_id;
    const source = sourcePath ?? source_path;
    const imported = importedAt ?? imported_at;
    validatedPdfFile(source);
    const parsed = path.parse(source);
    const originalFilename = path.basename(source);
    const title = parsed.name || "Imported PDF";
    const destination = this.studioPdfDestination(documentIdValue);
    await fs.promises.copyFile(source, destination);
    const storedFilePath = destination;

    try {
      this.withTransaction(() => {
        this.db.prepare(`
          INSERT INTO pages (${PAGE_COLUMNS})
          VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'studio_note', ?, ?)
        `).run(notePageIdValue, `${title} Notes`, imported, imported);
        this.db.prepare(`
          INSERT INTO studio_documents (id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 100, 1, 'pdf-left', ?, ?)
        `).run(documentIdValue, title, originalFilename, storedFilePath, notePageIdValue, imported, imported, imported);
        this.db.prepare(`
          INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
          VALUES (?, ?, ?, NULL, 'Primary note', 0, ?, ?)
        `).run(crypto.randomUUID(), documentIdValue, notePageIdValue, imported, imported);
      });
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }

    return this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`).get(documentIdValue);
  }

  async replaceStudioDocumentFile({ id, sourcePath, source_path, updatedAt, updated_at }) {
    const source = fs.realpathSync(sourcePath ?? source_path);
    validatedPdfFile(source);
    const destination = this.studioPdfDestination(id);
    const shouldCopy = fs.existsSync(destination) ? fs.realpathSync(destination) !== source : true;
    if (shouldCopy) await fs.promises.copyFile(source, destination);
    const result = this.db.prepare("UPDATE studio_documents SET original_filename = ?, stored_file_path = ?, updated_at = ? WHERE id = ?")
      .run(path.basename(source), destination, updatedAt ?? updated_at, id);
    if (result.changes === 0) throw new Error("document not found");
    return this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`).get(id);
  }

  updateStudioDocumentViewerState({ id, updates, updatedAt, updated_at }) {
    const current = this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`).get(id);
    if (!current) throw new Error("document not found");
    const viewerZoom = Math.max(25, Math.min(300, updates.viewer_zoom ?? current.viewer_zoom));
    const viewerPage = Math.max(1, updates.viewer_page ?? current.viewer_page);
    const panelLayout = updates.panel_layout === "note-left" || updates.panel_layout === "pdf-left" ? updates.panel_layout : current.panel_layout;
    const lastOpenedAt = updates.last_opened_at ?? current.last_opened_at;
    this.db.prepare(`
      UPDATE studio_documents
      SET viewer_zoom = ?, viewer_page = ?, panel_layout = ?, last_opened_at = ?, updated_at = ?
      WHERE id = ?
    `).run(viewerZoom, viewerPage, panelLayout, lastOpenedAt, updatedAt ?? updated_at, id);
  }

  renameStudioDocument({ id, title, updatedAt, updated_at }) {
    const trimmed = String(title ?? "").trim();
    if (!trimmed) throw new Error("title cannot be empty");
    const current = this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`).get(id);
    if (!current) throw new Error("document not found");
    const updated = updatedAt ?? updated_at;
    this.withTransaction(() => {
      this.db.prepare("UPDATE studio_documents SET title = ?, updated_at = ? WHERE id = ?").run(trimmed, updated, id);
      this.db.prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?").run(`${trimmed} Notes`, updated, current.note_page_id);
    });
  }

  getStudioDocumentStoredFilePath(id) {
    const row = this.db.prepare("SELECT stored_file_path FROM studio_documents WHERE id = ?").get(id);
    if (!row) throw new Error("document not found");
    return row.stored_file_path;
  }

  studioDocumentsRoot() {
    return path.join(this.appConfigDir, "studio-documents");
  }

  resolveStudioDocumentPdfPath(id) {
    return validateManagedStudioDocumentPath(this.getStudioDocumentStoredFilePath(id), this.studioDocumentsRoot());
  }

  async openStudioDocumentFile({ id }) {
    const storedPath = this.resolveStudioDocumentPdfPath(id);
    const error = await this.openPath(storedPath);
    if (error) throw new Error(error);
  }

  revealStudioDocumentFile({ id }) {
    const storedPath = this.resolveStudioDocumentPdfPath(id);
    this.revealPath(storedPath);
  }

  deleteStudioDocument({ id }) {
    const current = this.db.prepare(`SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`).get(id);
    if (!current) throw new Error("document not found");
    this.withTransaction(() => {
      this.db.prepare("DELETE FROM studio_document_page_links WHERE document_id = ?").run(id);
      this.db.prepare("DELETE FROM studio_documents WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM pages WHERE id = ?").run(current.note_page_id);
    });
    removeStoredStudioDocumentFile(current.stored_file_path, this.studioDocumentsRoot());
  }

  toggleFavorite({ id, isFavorite, is_favorite }) {
    this.db.prepare("UPDATE pages SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(isFavorite ?? is_favorite ? 1 : 0, id);
  }

  toggleTemplate({ id, isTemplate, is_template }) {
    this.db.prepare("UPDATE pages SET is_template = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(isTemplate ?? is_template ? 1 : 0, id);
  }

  createPageFromTemplate({ id, templateId, template_id, parentId, parent_id, createdAt, created_at }) {
    const template = this.getPage({ id: templateId ?? template_id });
    if (!template) throw new Error("template not found");
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `).get(parent, parent), "value");
    this.db.prepare(`
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
    `).run(
      id,
      template.title,
      parent,
      template.content,
      template.search_text,
      template.icon,
      template.cover_url,
      template.is_database,
      template.database_schema,
      template.properties,
      sortOrder,
      created,
      created
    );
    return this.getPage({ id });
  }

  duplicatePage({ id, sourceId, source_id, createdAt, created_at }) {
    const source = this.getPage({ id: sourceId ?? source_id });
    if (!source) throw new Error("source page not found");
    const created = createdAt ?? created_at;
    const title = `Copy of ${source.title}`;
    const sortOrder = rowValue(this.db.prepare(`
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `).get(source.parent_id, source.parent_id), "value");
    this.db.prepare(`
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
    `).run(
      id,
      title,
      source.parent_id,
      source.content,
      source.search_text,
      source.icon,
      source.cover_url,
      source.is_database,
      source.database_schema,
      source.properties,
      sortOrder,
      created,
      created
    );
    return this.getPage({ id });
  }

  importCoverImage({ sourcePath, source_path, pageId, page_id }) {
    const source = sourcePath ?? source_path;
    const pageIdValue = pageId ?? page_id;
    const coversDir = path.join(this.appConfigDir, "covers");
    ensurePrivateDirectory(coversDir);
    const extension = validatedCoverExtension(source, COVER_IMAGE_MAX_BYTES);
    const safePageId = String(pageIdValue ?? "").replace(/[^a-zA-Z0-9-]/g, "");
    const destination = path.join(coversDir, `${safePageId}-${Date.now()}.${extension}`);
    fs.copyFileSync(source, destination);
    return destination;
  }

  importEditorImage({ pageId, page_id, fileName, file_name, bytes }) {
    const pageIdValue = pageId ?? page_id;
    const fileNameValue = fileName ?? file_name ?? "image";
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const imagesDir = path.join(this.appConfigDir, "editor-images", safeStorageId(pageIdValue));
    ensurePrivateDirectory(imagesDir);
    const extension = validatedEditorImageExtension(fileNameValue, buffer);
    const destination = path.join(imagesDir, `${Date.now()}-${safeFileStem(fileNameValue)}.${extension}`);
    fs.writeFileSync(destination, buffer);
    return destination;
  }
}

module.exports = {
  OpenNotionBackend,
  openDatabase,
  runMigrations,
  ensurePrivateDirectory,
};
