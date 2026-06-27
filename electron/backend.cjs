const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  createBackendCommandRegistry,
} = require("./backend-command-registry.cjs");
const { createPageBackend } = require("./backend-pages.cjs");
const { createProfileBackend } = require("./backend-profile.cjs");
const {
  createStudioProjectBackend,
} = require("./backend-studio-projects.cjs");
const { createStudioLinkBackend } = require("./backend-studio-links.cjs");
const {
  createStudioDocumentBackend,
} = require("./backend-studio-documents.cjs");
const {
  createStudioUnificationBackend,
} = require("./backend-studio-unification.cjs");
const { createAssetBackend } = require("./backend-assets.cjs");
const { createBackupBackend } = require("./backend-backup.cjs");
const { createUpdateBackend } = require("./backend-updates.cjs");
const {
  APP_ASSET_PROTOCOL,
  EDITOR_VIDEO_MAX_BYTES,
  UPDATE_SIGNATURE_ALGORITHM,
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
  DEFAULT_UPDATE_PUBLIC_KEY_PATH,
  INVOKE_PATH_COMMANDS,
  INVOKE_SOURCE_PATH_COMMANDS,
  ensurePrivateDirectory,
  restrictDatabaseFilePermissions,
  hasColumn,
  runMigrations,
  runSyncDeviceMigration,
  CURRENT_APP_VERSION,
  DB_BACKUP_RETENTION,
  readStoredAppVersion,
  pruneDatabaseBackups,
  backupDatabaseFile,
  openDatabase,
  validateJsonPath,
  validateOptionalStringLength,
  normalizeImportedCoverUrl,
  IMPORTED_MEDIA_BLOCK_TYPES,
  sanitizeImportedBlockMedia,
  sanitizeImportedPageContent,
  validateImportedPage,
  allowedCoverExtension,
  coverExtensionFromMagic,
  isPathInside,
  validateManagedAssetPath,
  encodeAppAssetPath,
  decodeAppAssetPath,
  normalizePem,
  updateManifestPublicKey,
  canonicalJson,
  assertSafeInvokeArgs,
} = require("./backend-helpers.cjs");

class ShelfBackend {
  constructor({
    appConfigDir,
    downloadsDir,
    openPath,
    revealPath,
    openExternalUrl,
    updateManifestPublicKey: publicKey,
  }) {
    this.appConfigDir = appConfigDir;
    this.downloadsDir = downloadsDir || path.join(appConfigDir, "downloads");
    this.updateManifestPublicKey = updateManifestPublicKey(publicKey);
    this.verifiedUpdateDownloads = new Map();
    this.verifiedDownloadsByFingerprint = new Map();
    this.activeUpdateDownloads = new Map();
    this.db = openDatabase(appConfigDir);
    runSyncDeviceMigration(this.db);
    this.openPath = openPath || (() => Promise.resolve(""));
    this.revealPath = revealPath || (() => {});
    this.openExternal = openExternalUrl || (() => Promise.resolve(""));
    Object.assign(this, createUpdateBackend(this));
    Object.assign(this, createPageBackend(this));
    Object.assign(this, createProfileBackend(this));
    Object.assign(this, createBackupBackend(this));
    Object.assign(this, createAssetBackend(this));
    Object.assign(this, createStudioUnificationBackend(this));
    Object.assign(this, createStudioProjectBackend(this));
    Object.assign(this, createStudioLinkBackend(this));
    Object.assign(this, createStudioDocumentBackend(this));
    this.commands = createBackendCommandRegistry(this);
    this.autoMigrateStudioPageUnification();
  }

  async invoke(command, args = {}) {
    const handler = this.commands[command];
    if (!handler) throw new Error(`unknown command: ${command}`);
    assertSafeInvokeArgs(command, args);
    return await handler(args || {});
  }

  close() {
    this.db.close();
  }

  // Not registered in the renderer-facing command map on purpose: these two
  // take absolute filesystem paths, so they are only reachable from the main
  // process, which passes paths the user just picked in a native dialog.
  // The renderer itself never supplies a path.
  writeExportFiles({ targetPath, files }) {
    if (typeof targetPath !== "string" || !targetPath)
      throw new Error("export target path is required");
    if (!Array.isArray(files) || files.length === 0)
      throw new Error("export files are required");
    if (files.length > EXPORT_MAX_FILES)
      throw new Error(
        `export cannot contain more than ${EXPORT_MAX_FILES} files`,
      );

    let totalBytes = 0;
    for (const file of files) {
      if (
        !file ||
        typeof file.relativePath !== "string" ||
        typeof file.content !== "string"
      ) {
        throw new Error(
          "export files must have a relativePath and string content",
        );
      }
      validateExportRelativePath(file.relativePath);
      totalBytes += Buffer.byteLength(file.content, "utf8");
      if (totalBytes > EXPORT_MAX_TOTAL_BYTES)
        throw new Error("export content is too large");
    }

    // A single root-level file is written to the dialog path itself; a tree
    // export turns the dialog path (minus extension) into its root directory.
    if (files.length === 1 && !files[0].relativePath.includes("/")) {
      fs.writeFileSync(targetPath, files[0].content, "utf8");
      return { path: targetPath, fileCount: 1 };
    }

    const extension = path.extname(targetPath);
    const rootDir = extension
      ? targetPath.slice(0, -extension.length)
      : targetPath;
    for (const file of files) {
      const destination = path.join(rootDir, ...file.relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.content, "utf8");
    }
    return { path: rootDir, fileCount: files.length };
  }

  readImportFile({ path: filePath }) {
    if (typeof filePath !== "string" || !filePath)
      throw new Error("import path is required");
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error("import path must be a file");
    if (stats.size > IMPORT_MAX_BYTES)
      throw new Error("Import file is too large");
    return { path: filePath, content: fs.readFileSync(filePath, "utf8") };
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
    return validateManagedAssetPath(
      decodeAppAssetPath(assetPathToken),
      this.appConfigDir,
    );
  }

  async openExternalUrl({ url }) {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:")
      throw new Error("external URL must use HTTPS");
    const error = await this.openExternal(parsed.toString());
    if (error) throw new Error(error);
  }

}

module.exports = {
  ShelfBackend,
  openDatabase,
  runMigrations,
  ensurePrivateDirectory,
  restrictDatabaseFilePermissions,
};
