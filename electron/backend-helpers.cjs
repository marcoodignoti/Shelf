const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync } = require("node:sqlite");

const APP_SCHEMA_VERSION = "1";
const STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION = "2";
const APP_ASSET_PROTOCOL = "opennotion-app";
const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const PROFILE_TEXT_MAX_LENGTH = 120;
const PROFILE_METADATA_KEYS = {
  name: "profile_name",
  workspaceName: "workspace_name",
  avatarPath: "profile_avatar_path",
};
const STUDIO_PDF_MAX_BYTES = 512 * 1024 * 1024;
const EDITOR_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const UPDATE_MANIFEST_MAX_BYTES = 64 * 1024;
const UPDATE_ARTIFACT_MAX_BYTES = 512 * 1024 * 1024;
const UPDATE_SIGNATURE_ALGORITHM = "ed25519";
const UPDATE_DOWNLOAD_TOKEN_BYTES = 32;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const EXPORT_MAX_FILES = 2000;
const EXPORT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const IMPORT_MAX_BYTES = 25 * 1024 * 1024;

function validateExportRelativePath(relativePath) {
  if (!relativePath) throw new Error("export file path cannot be empty");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(relativePath) || relativePath.includes("\\")) {
    throw new Error("export file path contains unsupported characters");
  }
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("export file path cannot traverse directories");
    }
  }
}
const BACKUP_MAX_PAGES = 5000;
const BACKUP_MAX_ID_LENGTH = 512;
const BACKUP_MAX_TITLE_LENGTH = 512;
const BACKUP_MAX_TEXT_LENGTH = 1024 * 1024;
const BACKUP_MAX_METADATA_LENGTH = 1024 * 1024;
const BACKUP_MAX_ICON_LENGTH = 512;
const BACKUP_MAX_COVER_URL_LENGTH = 4096;
const UPDATE_MANIFEST_URLS = new Set([
  "https://github.com/marcoodignoti/Shelf/releases/download/beta/beta-update.json",
  "https://github.com/marcoodignoti/Shelf/releases/latest/download/beta-update.json",
]);
const UPDATE_DOWNLOAD_URL_PATTERN =
  /^https:\/\/github\.com\/marcoodignoti\/Shelf\/releases\/download\/[^/]+\/Shelf_[^/]+\.(dmg|zip|exe)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_UPDATE_PUBLIC_KEY_PATH = path.join(
  __dirname,
  "update-public-key.pem",
);
const INVOKE_PATH_COMMANDS = new Set([
  "export_backup",
  "import_backup",
  "import_studio_document",
  "replace_studio_document_file",
  "import_cover_image",
  "import_profile_avatar",
]);
const INVOKE_SOURCE_PATH_COMMANDS = new Set([
  "import_editor_image",
  "import_editor_video",
]);

const PAGE_COLUMNS =
  "id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at";
const STUDIO_DOCUMENT_COLUMNS =
  "id, title, original_filename, stored_file_path, note_page_id, project_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at";
const STUDIO_PROJECT_COLUMNS =
  "id, name, parent_id, sort_order, created_at, updated_at";
const STUDIO_DOCUMENT_PAGE_LINK_COLUMNS =
  "id, document_id, page_id, pdf_page, label, sort_order, created_at, updated_at";

function ensurePrivateDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(directoryPath, 0o700);
  }
}

function restrictDatabaseFilePermissions(dbPath) {
  if (process.platform === "win32") return;
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
    } catch {
      // A missing sidecar on a fresh DB, or a chmod race, must not fail startup.
    }
  }
}

function hasColumn(db, table, column) {
  return db
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .some((row) => row.name === column);
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

  db.prepare(
    `
    INSERT INTO app_metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO NOTHING
  `,
  ).run(APP_SCHEMA_VERSION);
  const currentSchemaVersion = String(
    rowValue(
      db
        .prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'")
        .get(),
      "value",
      APP_SCHEMA_VERSION,
    ),
  );
  if (
    numericSchemaVersion(currentSchemaVersion) <
    numericSchemaVersion(APP_SCHEMA_VERSION)
  ) {
    db.prepare(
      "UPDATE app_metadata SET value = ? WHERE key = 'schema_version'",
    ).run(APP_SCHEMA_VERSION);
  }

  const pageColumns = db
    .prepare("SELECT name FROM pragma_table_info('pages')")
    .all()
    .map((row) => row.name);
  const addPageColumn = (column, sql) => {
    if (!pageColumns.includes(column)) db.exec(sql);
  };

  addPageColumn("cover_url", "ALTER TABLE pages ADD COLUMN cover_url TEXT");
  if (!pageColumns.includes("search_text")) {
    db.exec("ALTER TABLE pages ADD COLUMN search_text TEXT");
    db.exec("UPDATE pages SET search_text = content WHERE search_text IS NULL");
  }
  addPageColumn(
    "is_deleted",
    "ALTER TABLE pages ADD COLUMN is_deleted INTEGER DEFAULT 0",
  );
  addPageColumn(
    "is_favorite",
    "ALTER TABLE pages ADD COLUMN is_favorite INTEGER DEFAULT 0",
  );
  if (!pageColumns.includes("sort_order")) {
    db.exec("ALTER TABLE pages ADD COLUMN sort_order INTEGER DEFAULT 0");
    db.exec("UPDATE pages SET sort_order = rowid WHERE sort_order = 0");
  }
  addPageColumn(
    "is_template",
    "ALTER TABLE pages ADD COLUMN is_template INTEGER DEFAULT 0",
  );
  addPageColumn(
    "is_database",
    "ALTER TABLE pages ADD COLUMN is_database INTEGER DEFAULT 0",
  );
  addPageColumn(
    "database_schema",
    "ALTER TABLE pages ADD COLUMN database_schema TEXT",
  );
  addPageColumn("properties", "ALTER TABLE pages ADD COLUMN properties TEXT");
  addPageColumn(
    "page_kind",
    "ALTER TABLE pages ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'note'",
  );
  db.exec(
    "UPDATE pages SET page_kind = 'project' WHERE id LIKE 'studio-project:%' AND page_kind <> 'project'",
  );

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

  if (!hasColumn(db, "studio_documents", "title")) {
    db.exec("ALTER TABLE studio_documents ADD COLUMN title TEXT");
    db.exec(`
      UPDATE studio_documents
      SET title = COALESCE(
        NULLIF(TRIM((SELECT pages.title FROM pages WHERE pages.id = studio_documents.id)), ''),
        NULLIF(TRIM(CASE
          WHEN lower(original_filename) LIKE '%.pdf' THEN substr(original_filename, 1, length(original_filename) - 4)
          ELSE original_filename
        END), ''),
        'Imported PDF'
      )
      WHERE title IS NULL OR TRIM(title) = ''
    `);
  }
  if (!hasColumn(db, "studio_documents", "note_page_id")) {
    db.exec("ALTER TABLE studio_documents ADD COLUMN note_page_id TEXT");
    db.exec(
      "UPDATE studio_documents SET note_page_id = id WHERE note_page_id IS NULL OR TRIM(note_page_id) = ''",
    );
  }
  if (!hasColumn(db, "studio_documents", "project_id")) {
    db.exec("ALTER TABLE studio_documents ADD COLUMN project_id TEXT");
  }
  db.exec(`
    UPDATE studio_documents
    SET title = 'Imported PDF'
    WHERE title IS NULL OR TRIM(title) = '';
    UPDATE studio_documents
    SET note_page_id = id
    WHERE note_page_id IS NULL OR TRIM(note_page_id) = '';
  `);

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

const CURRENT_APP_VERSION = (() => {
  try {
    return require("../package.json").version;
  } catch {
    return null;
  }
})();
const DB_BACKUP_RETENTION = 5;

function readStoredAppVersion(db) {
  try {
    const row = db
      .prepare("SELECT value FROM app_metadata WHERE key = 'app_version'")
      .get();
    return row ? String(row.value) : null;
  } catch {
    // Databases that predate app_metadata still deserve a backup; treat them
    // as "version unknown".
    return null;
  }
}

function pruneDatabaseBackups(backupsDir) {
  const backups = fs
    .readdirSync(backupsDir)
    .filter(
      (name) =>
        (name.startsWith("shelf-") || name.startsWith("opennotion-")) &&
        name.endsWith(".db"),
    )
    .map((name) => {
      const filePath = path.join(backupsDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((first, second) => second.mtimeMs - first.mtimeMs);
  for (const backup of backups.slice(DB_BACKUP_RETENTION)) {
    fs.rmSync(backup.filePath, { force: true });
  }
}

function backupDatabaseFile(db, dbPath, storedVersion) {
  const backupsDir = path.join(path.dirname(dbPath), "backups");
  ensurePrivateDirectory(backupsDir);
  // Fold the WAL into the main file first so the copy is a complete,
  // self-contained snapshot.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupsDir,
    `shelf-v${storedVersion || "unknown"}-${stamp}.db`,
  );
  fs.copyFileSync(dbPath, backupPath);
  pruneDatabaseBackups(backupsDir);
  return backupPath;
}

function openDatabase(appConfigDir, appVersion = CURRENT_APP_VERSION) {
  ensurePrivateDirectory(appConfigDir);
  const dbPath = path.join(appConfigDir, "opennotion.db");
  const databaseExisted = fs.existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  restrictDatabaseFilePermissions(dbPath);
  // Wait instead of failing with SQLITE_BUSY when another connection (e.g. a
  // lingering process from a previous run) briefly holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000");

  // First launch of a new app version: snapshot the database before the new
  // version's migrations touch it, so a bad migration can never destroy the
  // only copy of the user's data. Backup failure must not block startup.
  if (databaseExisted && appVersion) {
    const storedVersion = readStoredAppVersion(db);
    if (storedVersion !== appVersion) {
      try {
        backupDatabaseFile(db, dbPath, storedVersion);
      } catch (error) {
        console.error(
          "Failed to back up the database before migrating:",
          error,
        );
      }
    }
  }

  // Run migrations atomically: a failure midway (one ALTER succeeding, the
  // next failing) must not leave a partially-migrated schema behind.
  db.exec("BEGIN IMMEDIATE");
  try {
    runMigrations(db);
    if (appVersion) {
      db.prepare(
        `
        INSERT INTO app_metadata (key, value)
        VALUES ('app_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      ).run(appVersion);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  restrictDatabaseFilePermissions(dbPath);
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

function studioProjectPageId(projectId) {
  return `studio-project:${projectId}`;
}

function studioProjectIdFromPageId(pageId) {
  const prefix = "studio-project:";
  const value = String(pageId ?? "");
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function numericSchemaVersion(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (stats.size > BACKUP_MAX_BYTES)
    throw new Error("Backup file is too large");
}

function validateBackupExportDestination(filePath) {
  validateJsonPath(filePath);
  const parent = path.dirname(filePath);
  if (!fs.statSync(parent).isDirectory()) {
    throw new Error("backup destination parent must be a directory");
  }
}

function validateOptionalStringLength(field, value, maxLength) {
  if (
    value !== null &&
    value !== undefined &&
    String(value).length > maxLength
  ) {
    throw new Error(`backup field ${field} is too large`);
  }
}

const PAGE_KIND_VALUES = new Set(["note", "studio_note", "project"]);
const PAGE_BOOLEAN_FIELDS = new Set([
  "is_deleted",
  "is_favorite",
  "is_template",
  "is_database",
]);
const PAGE_STRING_LIMITS = {
  id: BACKUP_MAX_ID_LENGTH,
  parent_id: BACKUP_MAX_ID_LENGTH,
  title: BACKUP_MAX_TITLE_LENGTH,
  content: BACKUP_MAX_TEXT_LENGTH,
  search_text: BACKUP_MAX_TEXT_LENGTH,
  icon: BACKUP_MAX_ICON_LENGTH,
  cover_url: BACKUP_MAX_COVER_URL_LENGTH,
  database_schema: BACKUP_MAX_METADATA_LENGTH,
  properties: BACKUP_MAX_METADATA_LENGTH,
  created_at: BACKUP_MAX_TITLE_LENGTH,
  updated_at: BACKUP_MAX_TITLE_LENGTH,
};

function validateSizedStringField(
  field,
  value,
  maxLength,
  { allowNull = false, allowUndefined = false, requireNonEmpty = false } = {},
) {
  if (value === undefined) {
    if (allowUndefined) return;
    throw new Error(`${field} is required`);
  }
  if (value === null) {
    if (allowNull) return;
    throw new Error(`${field} cannot be null`);
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (requireNonEmpty && value.trim() === "")
    throw new Error(`${field} cannot be empty`);
  if (value.length > maxLength) throw new Error(`${field} is too large`);
}

function validatePageIdValue(field, value, options = {}) {
  validateSizedStringField(field, value, BACKUP_MAX_ID_LENGTH, {
    requireNonEmpty: true,
    ...options,
  });
}

function validateOptionalPageIdValue(field, value) {
  validateSizedStringField(field, value, BACKUP_MAX_ID_LENGTH, {
    allowNull: true,
    allowUndefined: true,
  });
}

function normalizePageBoolean(value, field, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === 0 || value === 1) return value;
  throw new Error(`${field} must be 0 or 1`);
}

function normalizePageKind(value, fallback = "note") {
  if (value === undefined || value === null || value === "") return fallback;
  if (!PAGE_KIND_VALUES.has(value)) throw new Error("page_kind is invalid");
  return value;
}

function validatePageCreateInput({ id, title, parent, created }) {
  validatePageIdValue("id", id);
  validateSizedStringField("title", title, BACKUP_MAX_TITLE_LENGTH, {
    allowUndefined: true,
  });
  validateOptionalPageIdValue("parent_id", parent);
  validateSizedStringField("created_at", created, BACKUP_MAX_TITLE_LENGTH, {
    requireNonEmpty: true,
  });
}

function validatePageUpdateInput(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new Error("updates must be an object");
  }

  const safeUpdates = {};
  for (const [field, value] of Object.entries(updates)) {
    if (PAGE_BOOLEAN_FIELDS.has(field)) {
      safeUpdates[field] = normalizePageBoolean(value, field);
      continue;
    }
    if (field === "page_kind") {
      safeUpdates[field] = normalizePageKind(value);
      continue;
    }
    if (field === "parent_id") {
      validateOptionalPageIdValue(field, value);
      safeUpdates[field] = value ?? null;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(PAGE_STRING_LIMITS, field)) {
      validateSizedStringField(field, value, PAGE_STRING_LIMITS[field], {
        allowNull: true,
      });
      safeUpdates[field] = value;
      continue;
    }
    throw new Error(`unsupported page update field: ${field}`);
  }
  return safeUpdates;
}

function normalizeImportedPageFlag(page, field) {
  return normalizePageBoolean(page[field], field, 0);
}

function normalizeImportedPageRecord(page) {
  validateImportedPage(page);
  return {
    ...page,
    parent_id: page.parent_id ?? null,
    content: page.content ?? null,
    search_text: page.search_text ?? null,
    icon: page.icon ?? null,
    cover_url: normalizeImportedCoverUrl(page.cover_url),
    is_deleted: normalizeImportedPageFlag(page, "is_deleted"),
    is_favorite: normalizeImportedPageFlag(page, "is_favorite"),
    is_template: normalizeImportedPageFlag(page, "is_template"),
    is_database: normalizeImportedPageFlag(page, "is_database"),
    database_schema: page.database_schema ?? null,
    properties: page.properties ?? null,
    sort_order: Number.isInteger(page.sort_order) ? page.sort_order : 0,
    page_kind: normalizePageKind(page.page_kind),
    content: sanitizeImportedPageContent(page.content),
  };
}

function validateImportedPagesArray(pages) {
  if (!Array.isArray(pages) || pages.length > BACKUP_MAX_PAGES) {
    throw new Error("import has invalid pages");
  }
  pages.forEach(validateImportedPage);
}

function normalizeImportedCoverUrl(value) {
  if (value === null || value === undefined) return null;
  const coverUrl = String(value).trim();
  if (!coverUrl) return null;
  if (/^https:\/\//i.test(coverUrl)) return coverUrl;
  if (/^blob:/i.test(coverUrl)) return coverUrl;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(coverUrl))
    return coverUrl;
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
    if (
      typeof next.props.url === "string" &&
      /^file:\/\//i.test(next.props.url)
    ) {
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
  return normalizeImportedPageRecord(page);
}

function validateImportedPage(page) {
  if (typeof page !== "object" || page === null || Array.isArray(page)) {
    throw new Error("Backup file has invalid pages");
  }
  validatePageIdValue("backup field id", page.id);
  validateSizedStringField(
    "backup field title",
    page.title,
    BACKUP_MAX_TITLE_LENGTH,
    { allowUndefined: true },
  );
  validateOptionalPageIdValue("backup field parent_id", page.parent_id);
  validateSizedStringField(
    "backup field content",
    page.content,
    BACKUP_MAX_TEXT_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field search_text",
    page.search_text,
    BACKUP_MAX_TEXT_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field icon",
    page.icon,
    BACKUP_MAX_ICON_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field cover_url",
    page.cover_url,
    BACKUP_MAX_COVER_URL_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field database_schema",
    page.database_schema,
    BACKUP_MAX_METADATA_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field properties",
    page.properties,
    BACKUP_MAX_METADATA_LENGTH,
    { allowNull: true, allowUndefined: true },
  );
  validateSizedStringField(
    "backup field created_at",
    page.created_at,
    BACKUP_MAX_TITLE_LENGTH,
    { allowUndefined: true },
  );
  validateSizedStringField(
    "backup field updated_at",
    page.updated_at,
    BACKUP_MAX_TITLE_LENGTH,
    { allowUndefined: true },
  );
  normalizePageKind(page.page_kind);
  for (const field of PAGE_BOOLEAN_FIELDS)
    normalizePageBoolean(page[field], field, 0);
  if (page.sort_order !== undefined && !Number.isInteger(page.sort_order)) {
    throw new Error("backup field sort_order is invalid");
  }
}

function readImportedBackup(filePath) {
  validateBackupImportSource(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  return parseImportedBackup(raw);
}

function parseImportedBackup(raw) {
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
  if (backup.version !== 1)
    throw new Error("Backup file version is not supported");
  if (
    typeof backup.exported_at !== "string" ||
    backup.exported_at.length > BACKUP_MAX_TITLE_LENGTH
  ) {
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
    parent_id: page.parent_id ? (idMap.get(page.parent_id) ?? null) : null,
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
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return "webp";
  }
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpg";
  if (
    bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) ||
    bytes.subarray(0, 6).equals(Buffer.from("GIF89a"))
  )
    return "gif";
  return null;
}

function validatedPdfFile(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".pdf")
    throw new Error("file must be a PDF");
  const stats = fs.statSync(filePath);
  if (stats.size > STUDIO_PDF_MAX_BYTES)
    throw new Error("PDF must be 512 MB or smaller");
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
  if (stats.size > maxBytes)
    throw new Error("cover image must be 10 MB or smaller");
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    const detected = coverExtensionFromMagic(header.subarray(0, bytesRead));
    if (!detected)
      throw new Error("cover image content is not a supported image");
    if (detected !== extension)
      throw new Error("cover image content does not match its extension");
    return extension;
  } finally {
    fs.closeSync(fd);
  }
}

function validatedEditorImageExtension(fileName, bytes) {
  if (bytes.length > COVER_IMAGE_MAX_BYTES)
    throw new Error("image must be 10 MB or smaller");
  const extension = allowedCoverExtension(fileName);
  if (!extension) throw new Error("image must be PNG, JPG, WebP, or GIF");
  const detected = coverExtensionFromMagic(bytes);
  if (!detected) throw new Error("image content is not a supported image");
  if (detected !== extension)
    throw new Error("image content does not match its extension");
  return extension;
}

function validatedEditorImageSource(filePath) {
  return validatedCoverExtension(String(filePath ?? ""), COVER_IMAGE_MAX_BYTES);
}

function allowedEditorVideoExtension(fileName) {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (extension === "mov") return "mov";
  if (extension === "m4v") return "m4v";
  if (extension === "webm") return "webm";
  if (extension === "mp4") return "mp4";
  return null;
}

function isIsoBaseMediaVideo(bytes) {
  if (bytes.length < 12 || !bytes.subarray(4, 8).equals(Buffer.from("ftyp")))
    return false;
  const brandText = bytes
    .subarray(8, Math.min(bytes.length, 64))
    .toString("latin1");
  return /\b(isom|iso2|mp41|mp42|M4V |qt  )/.test(brandText);
}

function isWebmVideo(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

function validatedEditorVideoExtension(fileName, bytes) {
  if (bytes.length > EDITOR_VIDEO_MAX_BYTES)
    throw new Error("video must be 512 MB or smaller");
  const extension = allowedEditorVideoExtension(fileName);
  if (!extension) throw new Error("video must be MP4, M4V, MOV, or WebM");
  const detected =
    extension === "webm" ? isWebmVideo(bytes) : isIsoBaseMediaVideo(bytes);
  if (!detected) throw new Error("video content is not a supported video");
  return extension;
}

function validatedEditorVideoSource(filePath) {
  const source = String(filePath ?? "");
  const extension = allowedEditorVideoExtension(source);
  if (!extension) throw new Error("video must be MP4, M4V, MOV, or WebM");
  const stats = fs.statSync(source);
  if (stats.size > EDITOR_VIDEO_MAX_BYTES)
    throw new Error("video must be 512 MB or smaller");
  const fd = fs.openSync(source, "r");
  try {
    const header = Buffer.alloc(64);
    const bytesRead = fs.readSync(fd, header, 0, 64, 0);
    return validatedEditorVideoExtension(source, header.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateManagedStudioDocumentPath(
  storedFilePath,
  studioDocumentsRoot,
) {
  const canonicalPath = fs.realpathSync(storedFilePath);
  const canonicalRoot = fs.realpathSync(studioDocumentsRoot);
  const expected =
    path.basename(canonicalPath) === "source.pdf" &&
    isPathInside(canonicalRoot, canonicalPath);
  if (!expected)
    throw new Error("stored Studio document path is outside app storage");
  return canonicalPath;
}

function validateManagedAssetPath(filePath, appConfigDir) {
  const canonicalPath = fs.realpathSync(filePath);
  const roots = [
    "covers",
    "editor-images",
    "editor-videos",
    "studio-documents",
    "avatars",
  ]
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
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .trim();
}

function updateManifestPublicKey(configuredKey) {
  if (configuredKey) return normalizePem(configuredKey);
  const publicKeyPath =
    process.env.SHELF_UPDATE_PUBLIC_KEY_PATH ||
    process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PATH;
  if (publicKeyPath) {
    return normalizePem(fs.readFileSync(path.resolve(publicKeyPath), "utf8"));
  }
  const publicKeyPem =
    process.env.SHELF_UPDATE_PUBLIC_KEY_PEM ||
    process.env.OPENNOTION_UPDATE_PUBLIC_KEY_PEM;
  if (publicKeyPem) {
    return normalizePem(publicKeyPem);
  }
  return normalizePem(fs.readFileSync(DEFAULT_UPDATE_PUBLIC_KEY_PATH, "utf8"));
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
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
  if (
    !envelope.payload ||
    typeof envelope.payload !== "object" ||
    Array.isArray(envelope.payload)
  ) {
    throw new Error("Invalid signed update manifest payload");
  }
  if (typeof envelope.signature !== "string" || !envelope.signature.trim()) {
    throw new Error("Invalid update manifest signature");
  }

  const payloadBytes = Buffer.from(canonicalJson(envelope.payload), "utf8");
  const signature = Buffer.from(envelope.signature, "base64");
  const verified = crypto.verify(
    null,
    payloadBytes,
    crypto.createPublicKey(publicKeyPem),
    signature,
  );
  if (!verified)
    throw new Error("Update manifest signature verification failed");
  return envelope.payload;
}

function updateArtifactFileName(parsedUrl) {
  const fileName = decodeURIComponent(path.basename(parsedUrl.pathname));
  if (!/^Shelf_[a-zA-Z0-9._-]+\.(dmg|zip|exe)$/i.test(fileName)) {
    throw new Error("update artifact filename is not trusted");
  }
  return fileName;
}

function trustedUpdateDownload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = String(value.url ?? "");
  const sha256 = String(value.sha256 ?? "")
    .trim()
    .toLowerCase();
  if (!UPDATE_DOWNLOAD_URL_PATTERN.test(url) || !SHA256_PATTERN.test(sha256))
    return null;
  return { url, sha256 };
}

function assertSafeInvokeArgs(command, args) {
  if (INVOKE_PATH_COMMANDS.has(command)) {
    throw new Error(`${command} requires a trusted file dialog`);
  }
  if (
    INVOKE_SOURCE_PATH_COMMANDS.has(command) &&
    args &&
    typeof args === "object" &&
    !Array.isArray(args) &&
    (typeof args.sourcePath === "string" ||
      typeof args.source_path === "string")
  ) {
    throw new Error(`${command} sourcePath requires a trusted file dialog`);
  }
}

function removeStoredStudioDocumentFile(storedFilePath, studioDocumentsRoot) {
  if (!fs.existsSync(storedFilePath)) return;
  const storedPath = validateManagedStudioDocumentPath(
    storedFilePath,
    studioDocumentsRoot,
  );
  fs.rmSync(storedPath, { force: true });
  fs.rmSync(path.dirname(storedPath), { recursive: true, force: true });
}

module.exports = {
  APP_SCHEMA_VERSION,
  STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION,
  APP_ASSET_PROTOCOL,
  COVER_IMAGE_MAX_BYTES,
  PROFILE_TEXT_MAX_LENGTH,
  PROFILE_METADATA_KEYS,
  STUDIO_PDF_MAX_BYTES,
  EDITOR_VIDEO_MAX_BYTES,
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_ARTIFACT_MAX_BYTES,
  UPDATE_SIGNATURE_ALGORITHM,
  UPDATE_DOWNLOAD_TOKEN_BYTES,
  BACKUP_MAX_BYTES,
  EXPORT_MAX_FILES,
  EXPORT_MAX_TOTAL_BYTES,
  IMPORT_MAX_BYTES,
  validateExportRelativePath,
  BACKUP_MAX_PAGES,
  BACKUP_MAX_ID_LENGTH,
  BACKUP_MAX_TITLE_LENGTH,
  BACKUP_MAX_TEXT_LENGTH,
  BACKUP_MAX_METADATA_LENGTH,
  BACKUP_MAX_ICON_LENGTH,
  BACKUP_MAX_COVER_URL_LENGTH,
  UPDATE_MANIFEST_URLS,
  UPDATE_DOWNLOAD_URL_PATTERN,
  SHA256_PATTERN,
  DEFAULT_UPDATE_PUBLIC_KEY_PATH,
  INVOKE_PATH_COMMANDS,
  INVOKE_SOURCE_PATH_COMMANDS,
  PAGE_COLUMNS,
  STUDIO_DOCUMENT_COLUMNS,
  STUDIO_PROJECT_COLUMNS,
  STUDIO_DOCUMENT_PAGE_LINK_COLUMNS,
  ensurePrivateDirectory,
  restrictDatabaseFilePermissions,
  hasColumn,
  runMigrations,
  CURRENT_APP_VERSION,
  DB_BACKUP_RETENTION,
  readStoredAppVersion,
  pruneDatabaseBackups,
  backupDatabaseFile,
  openDatabase,
  own,
  normalizeOptionalString,
  rowValue,
  studioProjectPageId,
  studioProjectIdFromPageId,
  numericSchemaVersion,
  lowerLikePattern,
  validateJsonPath,
  validateBackupImportSource,
  validateBackupExportDestination,
  validateOptionalStringLength,
  normalizeImportedCoverUrl,
  PAGE_KIND_VALUES,
  validatePageIdValue,
  validateOptionalPageIdValue,
  validatePageCreateInput,
  validatePageUpdateInput,
  validateImportedPagesArray,
  IMPORTED_MEDIA_BLOCK_TYPES,
  sanitizeImportedBlockMedia,
  sanitizeImportedPageContent,
  sanitizeImportedPageRecord,
  validateImportedPage,
  readImportedBackup,
  parseImportedBackup,
  prepareImportedBackupPages,
  allowedCoverExtension,
  coverExtensionFromMagic,
  validatedPdfFile,
  safeStorageId,
  safeFileStem,
  validatedCoverExtension,
  validatedEditorImageExtension,
  validatedEditorImageSource,
  allowedEditorVideoExtension,
  isIsoBaseMediaVideo,
  isWebmVideo,
  validatedEditorVideoExtension,
  validatedEditorVideoSource,
  isPathInside,
  validateManagedStudioDocumentPath,
  validateManagedAssetPath,
  encodeAppAssetPath,
  decodeAppAssetPath,
  normalizePem,
  updateManifestPublicKey,
  canonicalJson,
  signedManifestPayload,
  updateArtifactFileName,
  trustedUpdateDownload,
  assertSafeInvokeArgs,
  removeStoredStudioDocumentFile,
};
