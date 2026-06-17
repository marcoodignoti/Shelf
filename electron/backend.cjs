const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync } = require("node:sqlite");
const {
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
  validatePageIdValue,
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
    this.db = openDatabase(appConfigDir);
    this.openPath = openPath || (() => Promise.resolve(""));
    this.revealPath = revealPath || (() => {});
    this.openExternal = openExternalUrl || (() => Promise.resolve(""));
    this.commands = {
      list_pages: () => this.listPages(),
      list_all_pages: () => this.listAllPages(),
      export_backup: (args) => this.exportBackup(args),
      import_backup: (args) => this.importBackup(args),
      import_backup_content: (args) => this.importBackupContent(args),
      search_pages: (args) => this.searchPages(args),
      get_page: (args) => this.getPage(args),
      create_page: (args) => this.createPage(args),
      create_project: (args) => this.createProject(args),
      update_page: (args) => this.updatePage(args),
      delete_page: (args) => this.deletePage(args),
      delete_project: (args) => this.deleteProject(args),
      move_page: (args) => this.movePage(args),
      reorder_pages: (args) => this.reorderPages(args),
      import_pages: (args) => this.importPages(args),
      list_studio_documents: () => this.listStudioDocuments(),
      list_studio_projects: () => this.listStudioProjects(),
      preview_studio_page_unification: () =>
        this.previewStudioPageUnification(),
      migrate_studio_page_unification: (args) =>
        this.migrateStudioPageUnification(args),
      create_studio_project: (args) => this.createStudioProject(args),
      rename_studio_project: (args) => this.renameStudioProject(args),
      update_studio_project_parent: (args) =>
        this.updateStudioProjectParent(args),
      delete_studio_project: (args) => this.deleteStudioProject(args),
      update_studio_document_project: (args) =>
        this.updateStudioDocumentProject(args),
      list_all_studio_document_page_links: () =>
        this.listAllStudioDocumentPageLinks(),
      list_studio_document_page_links: (args) =>
        this.listStudioDocumentPageLinks(args),
      link_studio_document_page: (args) => this.linkStudioDocumentPage(args),
      update_studio_document_page_link: (args) =>
        this.updateStudioDocumentPageLink(args),
      unlink_studio_document_page: (args) =>
        this.unlinkStudioDocumentPage(args),
      import_studio_document: (args) => this.importStudioDocument(args),
      replace_studio_document_file: (args) =>
        this.replaceStudioDocumentFile(args),
      update_studio_document_viewer_state: (args) =>
        this.updateStudioDocumentViewerState(args),
      rename_studio_document: (args) => this.renameStudioDocument(args),
      open_studio_document_file: (args) => this.openStudioDocumentFile(args),
      reveal_studio_document_file: (args) =>
        this.revealStudioDocumentFile(args),
      delete_studio_document: (args) => this.deleteStudioDocument(args),
      toggle_favorite: (args) => this.toggleFavorite(args),
      toggle_template: (args) => this.toggleTemplate(args),
      create_page_from_template: (args) => this.createPageFromTemplate(args),
      duplicate_page: (args) => this.duplicatePage(args),
      import_cover_image: (args) => this.importCoverImage(args),
      import_editor_image: (args) => this.importEditorImage(args),
      import_editor_video: (args) => this.importEditorVideo(args),
      open_external_url: (args) => this.openExternalUrl(args),
      fetch_update_manifest: (args) => this.fetchUpdateManifest(args),
      download_update_artifact: (args) => this.downloadUpdateArtifact(args),
      get_workspace_profile: () => this.getWorkspaceProfile(),
      update_workspace_profile: (args) => this.updateWorkspaceProfile(args),
      import_profile_avatar: (args) => this.importProfileAvatar(args),
      show_character_palette: () => null,
    };
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

  schemaVersion() {
    return String(
      rowValue(
        this.db
          .prepare(
            "SELECT value FROM app_metadata WHERE key = 'schema_version'",
          )
          .get(),
        "value",
        "1",
      ),
    );
  }

  isStudioPageUnified() {
    return numericSchemaVersion(this.schemaVersion()) >= 2;
  }

  mirrorStudioProjectPage(project, updatedAt = project.updated_at) {
    const pageId = studioProjectPageId(project.id);
    const parentPageId = project.parent_id
      ? studioProjectPageId(project.parent_id)
      : null;
    const existing = this.db
      .prepare("SELECT id FROM pages WHERE id = ?")
      .get(pageId);
    if (existing) {
      this.db
        .prepare(
          `
        UPDATE pages
        SET title = ?, parent_id = ?, is_deleted = 0, page_kind = 'project', sort_order = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(project.name, parentPageId, project.sort_order, updatedAt, pageId);
      return pageId;
    }

    this.db
      .prepare(
        `
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'project', ?, ?)
    `,
      )
      .run(
        pageId,
        project.name,
        parentPageId,
        project.sort_order,
        project.created_at,
        updatedAt,
      );
    return pageId;
  }

  mirrorStudioDocumentPageParent(documentId, projectId, updatedAt) {
    if (!this.isStudioPageUnified()) return;
    const document = this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(documentId);
    if (!document) return;
    const parentPageId = projectId ? studioProjectPageId(projectId) : null;
    this.db
      .prepare(
        `
      UPDATE pages
      SET parent_id = ?, page_kind = 'note', updated_at = ?
      WHERE id = ?
    `,
      )
      .run(parentPageId, updatedAt, document.note_page_id);
  }

  autoMigrateStudioPageUnification() {
    if (this.isStudioPageUnified()) return;
    const preview = this.previewStudioPageUnification();
    if (!preview.can_migrate) return;
    this.migrateStudioPageUnification({ migratedAt: new Date().toISOString() });
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

  async fetchUpdateManifest({ url }) {
    const parsed = new URL(String(url ?? ""));
    if (parsed.protocol !== "https:")
      throw new Error("update manifest URL must use HTTPS");
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

    const contentLength = Number.parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    if (
      Number.isFinite(contentLength) &&
      contentLength > UPDATE_MANIFEST_MAX_BYTES
    ) {
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
    return this.rememberVerifiedUpdateDownloads(
      signedManifestPayload(signedManifest, this.updateManifestPublicKey),
    );
  }

  rememberVerifiedUpdateDownloads(payload) {
    const manifest = structuredClone(payload);
    const downloads =
      manifest &&
      typeof manifest === "object" &&
      !Array.isArray(manifest) &&
      manifest.downloads &&
      typeof manifest.downloads === "object" &&
      !Array.isArray(manifest.downloads)
        ? manifest.downloads
        : {};
    this.verifiedUpdateDownloads.clear();
    for (const key of Object.keys(downloads)) {
      const download = trustedUpdateDownload(downloads[key]);
      if (!download) continue;
      const downloadToken = crypto
        .randomBytes(UPDATE_DOWNLOAD_TOKEN_BYTES)
        .toString("base64url");
      this.verifiedUpdateDownloads.set(downloadToken, download);
      downloads[key] = { ...downloads[key], downloadToken };
    }
    return manifest;
  }

  verifiedUpdateDownload({ downloadToken, url, sha256 }) {
    const token = String(downloadToken ?? "").trim();
    const verified = this.verifiedUpdateDownloads.get(token);
    if (!verified)
      throw new Error("update download is not linked to a verified manifest");
    const requestedUrl = String(url ?? "");
    const requestedSha256 = String(sha256 ?? "")
      .trim()
      .toLowerCase();
    if (requestedUrl !== verified.url || requestedSha256 !== verified.sha256) {
      throw new Error("update download does not match verified manifest");
    }
    this.verifiedUpdateDownloads.delete(token);
    return verified;
  }

  async downloadUpdateArtifact({ url, sha256, downloadToken, download_token }) {
    const verifiedDownload = this.verifiedUpdateDownload({
      downloadToken: downloadToken ?? download_token,
      url,
      sha256,
    });
    const parsed = new URL(String(url ?? ""));
    const expectedSha256 = verifiedDownload.sha256;
    if (!UPDATE_DOWNLOAD_URL_PATTERN.test(parsed.toString())) {
      throw new Error("update download URL is not trusted");
    }
    if (!SHA256_PATTERN.test(expectedSha256)) {
      throw new Error("update checksum is invalid");
    }

    const fileName = updateArtifactFileName(parsed);
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    const finalPath = path.join(this.downloadsDir, fileName);
    const tempPath = path.join(
      this.downloadsDir,
      `.${fileName}.${process.pid}.${Date.now()}.download`,
    );

    try {
      const response = await fetch(parsed.toString(), {
        headers: { accept: "application/octet-stream" },
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok)
        throw new Error(`Update download failed (${response.status})`);
      if (!response.body) throw new Error("Update download response is empty");

      const contentLength = Number.parseInt(
        response.headers.get("content-length") || "0",
        10,
      );
      if (
        Number.isFinite(contentLength) &&
        contentLength > UPDATE_ARTIFACT_MAX_BYTES
      ) {
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
            if (bytes > UPDATE_ARTIFACT_MAX_BYTES)
              throw new Error("Update download is too large");
            hash.update(buffer);
            yield buffer;
          }
        },
        fs.createWriteStream(tempPath, { flags: "w" }),
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
    return this.db
      .prepare(
        `SELECT ${PAGE_COLUMNS} FROM pages WHERE is_deleted = 0 AND page_kind IN ('note', 'studio_note', 'project') ORDER BY sort_order ASC, created_at DESC`,
      )
      .all();
  }

  listAllPages() {
    return this.db
      .prepare(
        `SELECT ${PAGE_COLUMNS} FROM pages ORDER BY sort_order ASC, created_at DESC`,
      )
      .all();
  }

  searchPages({ query }) {
    const trimmed = String(query ?? "").trim();
    if (!trimmed) return [];
    const pattern = lowerLikePattern(trimmed);
    return this.db
      .prepare(
        `
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
    `,
      )
      .all(pattern, pattern, pattern, pattern);
  }

  getPage({ id }) {
    return (
      this.db
        .prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`)
        .get(id) || null
    );
  }

  createPage({ id, title, parentId, parent_id, createdAt, created_at }) {
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    validatePageCreateInput({ id, title, parent, created });
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `,
        )
        .get(parent, parent),
      "value",
    );

    this.db
      .prepare(
        `
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'note', ?, ?)
    `,
      )
      .run(id, title, parent, sortOrder, created, created);
    return this.getPage({ id });
  }

  createProject({ id, title, createdAt, created_at }) {
    const created = createdAt ?? created_at;
    validatePageCreateInput({ id, title, parent: null, created });
    const trimmed = String(title ?? "").trim();
    if (!trimmed) throw new Error("project title cannot be empty");
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND page_kind = 'project'
    `,
        )
        .get(),
      "value",
    );

    this.db
      .prepare(
        `
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'project', ?, ?)
    `,
      )
      .run(id, trimmed, sortOrder, created, created);
    return this.getPage({ id });
  }

  updatePage({ id, updates, updatedAt, updated_at }) {
    validatePageIdValue("id", id);
    const safeUpdates = validatePageUpdateInput(updates);
    const updated = updatedAt ?? updated_at;
    this.withTransaction(() => {
      const setClauses = [];
      const values = [];

      const hasTitle = own(safeUpdates, "title");
      const hasContent = own(safeUpdates, "content");

      if (hasTitle) {
        setClauses.push("title = ?");
        values.push(safeUpdates.title);
        const studioProjectId = studioProjectIdFromPageId(id);
        if (studioProjectId) {
          this.db
            .prepare(
              "UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ?",
            )
            .run(safeUpdates.title, updated, studioProjectId);
        }
      }

      if (own(safeUpdates, "parent_id")) {
        setClauses.push("parent_id = ?");
        values.push(safeUpdates.parent_id);
      }

      if (hasContent) {
        setClauses.push("content = ?");
        values.push(safeUpdates.content);
        const searchText = own(safeUpdates, "search_text")
          ? safeUpdates.search_text
          : safeUpdates.content;
        setClauses.push("search_text = ?");
        values.push(searchText);
      }

      const simpleFields = [
        "icon",
        "cover_url",
        "is_deleted",
        "is_favorite",
        "is_template",
        "is_database",
        "database_schema",
        "properties",
        "page_kind",
      ];
      for (const field of simpleFields) {
        if (own(safeUpdates, field)) {
          setClauses.push(`${field} = ?`);
          values.push(safeUpdates[field]);
        }
      }

      if (setClauses.length > 0) {
        setClauses.push("updated_at = ?");
        values.push(updated);
        values.push(id);

        this.db
          .prepare(`UPDATE pages SET ${setClauses.join(", ")} WHERE id = ?`)
          .run(...values);
      }
    });
  }

  deletePage({ id }) {
    const studioDocumentMatch = this.db
      .prepare(
        `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM pages WHERE id = ?
        UNION ALL
        SELECT pages.id FROM pages
        JOIN descendants ON pages.parent_id = descendants.id
      )
      SELECT studio_documents.id
      FROM studio_documents
      JOIN descendants ON descendants.id = studio_documents.note_page_id
      LIMIT 1
    `,
      )
      .get(id);
    if (studioDocumentMatch) {
      throw new Error(
        "delete the Studio document before deleting its primary note",
      );
    }

    this.withTransaction(() => {
      this.db
        .prepare(
          `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        DELETE FROM studio_document_page_links
        WHERE page_id IN (SELECT id FROM descendants)
      `,
        )
        .run(id);
      this.db
        .prepare(
          `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        DELETE FROM pages
        WHERE id IN (SELECT id FROM descendants)
      `,
        )
        .run(id);
    });
  }

  deleteProject({ id, updatedAt, updated_at }) {
    const updated = updatedAt ?? updated_at;
    const project = this.db
      .prepare(
        `SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0 AND page_kind = 'project'`,
      )
      .get(id);
    if (!project) throw new Error("project not found");
    const studioProjectId = studioProjectIdFromPageId(id);

    this.withTransaction(() => {
      this.db
        .prepare(
          "UPDATE pages SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
        )
        .run(updated, id);
      if (studioProjectId) {
        this.db
          .prepare(
            "UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ?",
          )
          .run(updated, studioProjectId);
        this.db
          .prepare(
            "UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
          )
          .run(updated, studioProjectId);
        this.db
          .prepare("DELETE FROM studio_projects WHERE id = ?")
          .run(studioProjectId);
      }
      this.db
        .prepare("DELETE FROM studio_document_page_links WHERE page_id = ?")
        .run(id);
      this.db
        .prepare("DELETE FROM pages WHERE id = ? AND page_kind = 'project'")
        .run(id);
    });
  }

  movePage({ id, parentId, parent_id, updatedAt, updated_at }) {
    const parent = parentId ?? parent_id ?? null;
    const updated = updatedAt ?? updated_at;
    if (parent) {
      if (parent === id) throw new Error("page cannot be moved under itself");
      const parentExists = this.db
        .prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
        .get(parent);
      if (!parentExists) throw new Error("target parent page does not exist");
      const descendantMatch = this.db
        .prepare(
          `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE parent_id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        SELECT id FROM descendants WHERE id = ? LIMIT 1
      `,
        )
        .get(id, parent);
      if (descendantMatch)
        throw new Error("page cannot be moved under one of its descendants");
    }
    const result = this.db
      .prepare("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?")
      .run(parent, updated, id);
    if (result.changes === 0) throw new Error("page does not exist");
  }

  reorderPages({
    parentId,
    parent_id,
    orderedIds,
    ordered_ids,
    updatedAt,
    updated_at,
  }) {
    const parent = parentId ?? parent_id ?? null;
    const ordered = orderedIds ?? ordered_ids ?? [];
    const updated = updatedAt ?? updated_at;
    if (ordered.length === 0) return;
    this.withTransaction(() => {
      ordered.forEach((id, index) => {
        const result = this.db
          .prepare(
            `
          UPDATE pages
          SET sort_order = ?, updated_at = ?
          WHERE id = ?
            AND is_deleted = 0
            AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
        `,
          )
          .run(index, updated, id, parent, parent);
        if (result.changes === 0)
          throw new Error("page order contains invalid page");
      });
    });
  }

  importPages({ pages }) {
    return this.importPageRecords(pages || []);
  }

  importPageRecords(pages, { inTransaction = false } = {}) {
    validateImportedPagesArray(pages);
    let importedCount = 0;
    const work = () => {
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
          sanitizedPage.updated_at,
        ).changes;
      }
    };
    if (inTransaction) {
      work();
    } else {
      this.withTransaction(work);
    }
    return importedCount;
  }

  exportBackup({ path: filePath, exportedAt, exported_at }) {
    const exported = exportedAt ?? exported_at;
    validateBackupExportDestination(filePath);
    const pages = this.listAllPages();
    const profile = (() => {
      const p = this.getWorkspaceProfile();
      return { name: p.name, workspaceName: p.workspaceName };
    })();
    const raw = JSON.stringify(
      { version: 1, exported_at: exported, profile, pages },
      null,
      2,
    );
    if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES)
      throw new Error("Backup export is too large");
    // Write-to-temp-then-rename so an interrupted write (disk full, crash)
    // cannot leave a truncated backup at the destination.
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.tmp`,
    );
    try {
      fs.writeFileSync(tempPath, raw);
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
    return pages.length;
  }

  importBackup({ path: filePath, importedAt, imported_at }) {
    const imported = importedAt ?? imported_at;
    const backup = readImportedBackup(filePath);
    return this.importBackupData(backup, imported);
  }

  importBackupContent({ content, importedAt, imported_at }) {
    const imported = importedAt ?? imported_at;
    if (typeof content !== "string")
      throw new Error("backup content is required");
    return this.importBackupData(parseImportedBackup(content), imported);
  }

  backupProfilePatch(backup) {
    if (
      !backup.profile ||
      typeof backup.profile !== "object" ||
      Array.isArray(backup.profile)
    )
      return null;
    const patch = {};
    const { name, workspaceName } = backup.profile;
    if (name !== undefined) {
      if (typeof name !== "string" || name.length > PROFILE_TEXT_MAX_LENGTH) {
        throw new Error("backup profile name too long or invalid");
      }
      patch.name = name;
    }
    if (workspaceName !== undefined) {
      if (
        typeof workspaceName !== "string" ||
        workspaceName.length > PROFILE_TEXT_MAX_LENGTH
      ) {
        throw new Error("backup workspace name too long or invalid");
      }
      patch.workspaceName = workspaceName;
    }
    return patch;
  }

  importBackupData(backup, imported) {
    const profilePatch = this.backupProfilePatch(backup);
    const importedPages = prepareImportedBackupPages(backup.pages, imported);
    let importedCount = 0;
    this.withTransaction(() => {
      importedCount = this.importPageRecords(importedPages, {
        inTransaction: true,
      });
      if (profilePatch) {
        const current = this.getWorkspaceProfile();
        if (current.name === "" && current.workspaceName === "Shelf") {
          if (profilePatch.name !== undefined) {
            this.writeMetadataValue(
              PROFILE_METADATA_KEYS.name,
              profilePatch.name,
            );
          }
          if (profilePatch.workspaceName !== undefined) {
            this.writeMetadataValue(
              PROFILE_METADATA_KEYS.workspaceName,
              profilePatch.workspaceName,
            );
          }
        }
      }
    });
    return importedCount;
  }

  listStudioDocuments() {
    return this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents ORDER BY last_opened_at DESC, created_at DESC`,
      )
      .all();
  }

  listStudioProjects() {
    return this.db
      .prepare(
        `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects ORDER BY sort_order ASC, name ASC`,
      )
      .all();
  }

  previewStudioPageUnification() {
    const schemaVersion = String(
      rowValue(
        this.db
          .prepare(
            "SELECT value FROM app_metadata WHERE key = 'schema_version'",
          )
          .get(),
        "value",
        APP_SCHEMA_VERSION,
      ),
    );
    const scalar = (sql) =>
      Number(rowValue(this.db.prepare(sql).get(), "value"));
    const missingPrimaryPages = scalar(`
      SELECT COUNT(*) AS value
      FROM studio_documents documents
      LEFT JOIN pages ON pages.id = documents.note_page_id AND pages.is_deleted = 0
      WHERE pages.id IS NULL
    `);
    const missingPrimaryLinks = scalar(`
      SELECT COUNT(*) AS value
      FROM studio_documents documents
      LEFT JOIN studio_document_page_links links
        ON links.document_id = documents.id
       AND links.page_id = documents.note_page_id
      WHERE links.id IS NULL
    `);
    const orphanLinks = scalar(`
      SELECT COUNT(*) AS value
      FROM studio_document_page_links links
      LEFT JOIN studio_documents documents ON documents.id = links.document_id
      LEFT JOIN pages ON pages.id = links.page_id AND pages.is_deleted = 0
      WHERE documents.id IS NULL OR pages.id IS NULL
    `);
    const blockers = [];
    if (missingPrimaryPages > 0) blockers.push("missing_primary_pages");
    if (missingPrimaryLinks > 0) blockers.push("missing_primary_links");
    if (orphanLinks > 0) blockers.push("orphan_links");

    return {
      schema_version: schemaVersion,
      project_count: scalar("SELECT COUNT(*) AS value FROM studio_projects"),
      nested_project_count: scalar(
        "SELECT COUNT(*) AS value FROM studio_projects WHERE parent_id IS NOT NULL",
      ),
      document_count: scalar("SELECT COUNT(*) AS value FROM studio_documents"),
      document_without_project_count: scalar(
        "SELECT COUNT(*) AS value FROM studio_documents WHERE project_id IS NULL",
      ),
      link_count: scalar(
        "SELECT COUNT(*) AS value FROM studio_document_page_links",
      ),
      linked_regular_page_count: scalar(`
        SELECT COUNT(*) AS value
        FROM studio_document_page_links links
        JOIN pages ON pages.id = links.page_id
        WHERE pages.is_deleted = 0 AND pages.page_kind = 'note'
      `),
      linked_studio_note_count: scalar(`
        SELECT COUNT(*) AS value
        FROM studio_document_page_links links
        JOIN pages ON pages.id = links.page_id
        WHERE pages.is_deleted = 0 AND pages.page_kind = 'studio_note'
      `),
      missing_primary_page_count: missingPrimaryPages,
      missing_primary_link_count: missingPrimaryLinks,
      orphan_link_count: orphanLinks,
      blockers,
      can_migrate: blockers.length === 0,
    };
  }

  backupStudioPageUnificationTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_documents_backup_page_unification AS
        SELECT * FROM studio_documents WHERE 0;
      CREATE TABLE IF NOT EXISTS studio_projects_backup_page_unification AS
        SELECT * FROM studio_projects WHERE 0;
      CREATE TABLE IF NOT EXISTS studio_document_page_links_backup_page_unification AS
        SELECT * FROM studio_document_page_links WHERE 0;
    `);
    if (
      rowValue(
        this.db
          .prepare(
            "SELECT COUNT(*) AS value FROM studio_documents_backup_page_unification",
          )
          .get(),
        "value",
      ) === 0
    ) {
      this.db.exec(
        "INSERT INTO studio_documents_backup_page_unification SELECT * FROM studio_documents",
      );
    }
    if (
      rowValue(
        this.db
          .prepare(
            "SELECT COUNT(*) AS value FROM studio_projects_backup_page_unification",
          )
          .get(),
        "value",
      ) === 0
    ) {
      this.db.exec(
        "INSERT INTO studio_projects_backup_page_unification SELECT * FROM studio_projects",
      );
    }
    if (
      rowValue(
        this.db
          .prepare(
            "SELECT COUNT(*) AS value FROM studio_document_page_links_backup_page_unification",
          )
          .get(),
        "value",
      ) === 0
    ) {
      this.db.exec(
        "INSERT INTO studio_document_page_links_backup_page_unification SELECT * FROM studio_document_page_links",
      );
    }
  }

  migrateStudioPageUnification({ migratedAt, migrated_at } = {}) {
    const migrated = migratedAt ?? migrated_at ?? new Date().toISOString();
    const before = this.previewStudioPageUnification();
    if (!before.can_migrate) {
      throw new Error(
        `cannot migrate Studio pages: ${before.blockers.join(", ")}`,
      );
    }

    this.withTransaction(() => {
      this.backupStudioPageUnificationTables();

      const projects = this.db
        .prepare(
          `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects ORDER BY sort_order ASC, name ASC`,
        )
        .all();
      for (const project of projects) {
        this.mirrorStudioProjectPage(project, migrated);
      }

      const documents = this.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents ORDER BY created_at ASC`,
        )
        .all();
      for (const document of documents) {
        const parentPageId = document.project_id
          ? studioProjectPageId(document.project_id)
          : null;
        this.db
          .prepare(
            `
          UPDATE pages
          SET title = ?, parent_id = ?, page_kind = 'note', updated_at = ?
          WHERE id = ?
        `,
          )
          .run(document.title, parentPageId, migrated, document.note_page_id);
      }

      for (const document of documents) {
        if (document.id === document.note_page_id) continue;
        const temporaryId = `__page_unification__${document.id}`;
        this.db
          .prepare("UPDATE studio_documents SET id = ? WHERE id = ?")
          .run(temporaryId, document.id);
        this.db
          .prepare(
            "UPDATE studio_document_page_links SET document_id = ? WHERE document_id = ?",
          )
          .run(temporaryId, document.id);
      }

      for (const document of documents) {
        if (document.id === document.note_page_id) continue;
        const temporaryId = `__page_unification__${document.id}`;
        this.db
          .prepare(
            "UPDATE studio_documents SET id = ?, updated_at = ? WHERE id = ?",
          )
          .run(document.note_page_id, migrated, temporaryId);
        this.db
          .prepare(
            "UPDATE studio_document_page_links SET document_id = ?, updated_at = ? WHERE document_id = ?",
          )
          .run(document.note_page_id, migrated, temporaryId);
      }

      this.db
        .prepare(
          `
        INSERT INTO app_metadata (key, value)
        VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
        )
        .run(STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION);
    });

    return this.previewStudioPageUnification();
  }

  createStudioProject({
    id,
    name,
    parentId,
    parent_id,
    createdAt,
    created_at,
  }) {
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("project name cannot be empty");
    if (parent) {
      const count = rowValue(
        this.db
          .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
          .get(parent),
        "value",
      );
      if (count === 0) throw new Error("parent project not found");
    }
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_projects
      WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
    `,
        )
        .get(parent, parent),
      "value",
    );
    this.db
      .prepare(
        "INSERT INTO studio_projects (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, trimmed, parent, sortOrder, created, created);
    if (this.isStudioPageUnified()) {
      this.mirrorStudioProjectPage(
        {
          id,
          name: trimmed,
          parent_id: parent,
          sort_order: sortOrder,
          created_at: created,
          updated_at: created,
        },
        created,
      );
    }
    return this.db
      .prepare(
        `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects WHERE id = ?`,
      )
      .get(id);
  }

  renameStudioProject({ id, name, updatedAt, updated_at }) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("project name cannot be empty");
    const updated = updatedAt ?? updated_at;
    const result = this.db
      .prepare(
        "UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ?",
      )
      .run(trimmed, updated, id);
    if (result.changes === 0) throw new Error("project not found");
    if (this.isStudioPageUnified()) {
      this.db
        .prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
        .run(trimmed, updated, studioProjectPageId(id));
    }
  }

  updateStudioProjectParent({
    id,
    parentId,
    parent_id,
    updatedAt,
    updated_at,
  }) {
    const parent = parentId ?? parent_id ?? null;
    const updated = updatedAt ?? updated_at;
    if (parent === id) throw new Error("project cannot be its own parent");
    if (parent) {
      const parentExists = rowValue(
        this.db
          .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
          .get(parent),
        "value",
      );
      if (parentExists === 0) throw new Error("parent project not found");
      const wouldCycle = rowValue(
        this.db
          .prepare(
            `
        WITH RECURSIVE ancestors(id, parent_id) AS (
          SELECT id, parent_id FROM studio_projects WHERE id = ?
          UNION ALL
          SELECT studio_projects.id, studio_projects.parent_id
          FROM studio_projects
          INNER JOIN ancestors ON studio_projects.id = ancestors.parent_id
        )
        SELECT COUNT(*) AS value FROM ancestors WHERE id = ?
      `,
          )
          .get(parent, id),
        "value",
      );
      if (wouldCycle > 0) throw new Error("project cycle not allowed");
    }
    const projectExists = rowValue(
      this.db
        .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
        .get(id),
      "value",
    );
    if (projectExists === 0) throw new Error("project not found");
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_projects
      WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
    `,
        )
        .get(parent, parent),
      "value",
    );
    const result = this.db
      .prepare(
        "UPDATE studio_projects SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
      )
      .run(parent, sortOrder, updated, id);
    if (result.changes === 0) throw new Error("project not found");
    if (this.isStudioPageUnified()) {
      this.db
        .prepare(
          "UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          parent ? studioProjectPageId(parent) : null,
          sortOrder,
          updated,
          studioProjectPageId(id),
        );
    }
  }

  deleteStudioProject({ id, updatedAt, updated_at }) {
    const updated = updatedAt ?? updated_at;
    let deleted = 0;
    this.withTransaction(() => {
      this.db
        .prepare(
          "UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ?",
        )
        .run(updated, id);
      if (this.isStudioPageUnified()) {
        this.db
          .prepare(
            `
          UPDATE pages
          SET parent_id = NULL, updated_at = ?
          WHERE id IN (SELECT note_page_id FROM studio_documents WHERE project_id IS NULL)
        `,
          )
          .run(updated);
      }
      this.db
        .prepare(
          "UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
        )
        .run(updated, id);
      if (this.isStudioPageUnified()) {
        this.db
          .prepare(
            "UPDATE pages SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
          )
          .run(updated, studioProjectPageId(id));
        this.db
          .prepare(
            "UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?",
          )
          .run(updated, studioProjectPageId(id));
      }
      deleted = this.db
        .prepare("DELETE FROM studio_projects WHERE id = ?")
        .run(id).changes;
    });
    if (deleted === 0) throw new Error("project not found");
  }

  updateStudioDocumentProject({
    id,
    projectId,
    project_id,
    updatedAt,
    updated_at,
  }) {
    const project = projectId ?? project_id ?? null;
    if (project) {
      const projectExists = rowValue(
        this.db
          .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
          .get(project),
        "value",
      );
      if (projectExists === 0) throw new Error("project not found");
    }
    const updated = updatedAt ?? updated_at;
    const result = this.db
      .prepare(
        "UPDATE studio_documents SET project_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(project, updated, id);
    if (result.changes === 0) throw new Error("document not found");
    this.mirrorStudioDocumentPageParent(id, project, updated);
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
        NULL AS content,
        NULL AS search_text,
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
    return this.db
      .prepare(
        `
      ${this.studioDocumentPageLinkSelectSql()}
      WHERE links.document_id = ?
        AND pages.is_deleted = 0
      ORDER BY links.sort_order ASC, links.created_at ASC
    `,
      )
      .all(document)
      .map((row) => this.studioDocumentPageLinkFromRow(row));
  }

  listAllStudioDocumentPageLinks() {
    return this.db
      .prepare(
        `
      ${this.studioDocumentPageLinkSelectSql()}
      JOIN studio_documents documents ON documents.id = links.document_id
      WHERE pages.is_deleted = 0
      ORDER BY documents.title COLLATE NOCASE ASC, links.sort_order ASC, links.created_at ASC
    `,
      )
      .all()
      .map((row) => this.studioDocumentPageLinkFromRow(row));
  }

  linkStudioDocumentPage({
    id,
    documentId,
    document_id,
    pageId,
    page_id,
    pdfPage,
    pdf_page,
    label,
    createdAt,
    created_at,
  }) {
    const linkId = id || crypto.randomUUID();
    const document = documentId ?? document_id;
    const page = pageId ?? page_id;
    const created = createdAt ?? created_at;
    const pdfPageValue = Number.isFinite(Number(pdfPage ?? pdf_page))
      ? Math.max(1, Math.round(Number(pdfPage ?? pdf_page)))
      : null;
    const labelValue = normalizeOptionalString(label);
    const documentExists = rowValue(
      this.db
        .prepare("SELECT COUNT(*) AS value FROM studio_documents WHERE id = ?")
        .get(document),
      "value",
    );
    if (documentExists === 0) throw new Error("document not found");
    const pageExists = rowValue(
      this.db
        .prepare(
          "SELECT COUNT(*) AS value FROM pages WHERE id = ? AND is_deleted = 0",
        )
        .get(page),
      "value",
    );
    if (pageExists === 0) throw new Error("page not found");
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
      FROM studio_document_page_links
      WHERE document_id = ?
    `,
        )
        .get(document),
      "value",
    );

    this.db
      .prepare(
        `
      INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, page_id) DO UPDATE SET
        pdf_page = excluded.pdf_page,
        label = excluded.label,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        linkId,
        document,
        page,
        pdfPageValue,
        labelValue,
        sortOrder,
        created,
        created,
      );

    const row = this.db
      .prepare(
        `
      ${this.studioDocumentPageLinkSelectSql()}
      WHERE links.document_id = ?
        AND links.page_id = ?
        AND pages.is_deleted = 0
    `,
      )
      .get(document, page);
    return this.studioDocumentPageLinkFromRow(row);
  }

  updateStudioDocumentPageLink({
    id,
    pdfPage,
    pdf_page,
    label,
    updatedAt,
    updated_at,
  }) {
    const pdfPageInput = pdfPage ?? pdf_page;
    const pdfPageValue =
      pdfPageInput === null || pdfPageInput === undefined || pdfPageInput === ""
        ? null
        : Math.max(1, Math.round(Number(pdfPageInput)));
    if (pdfPageValue !== null && !Number.isFinite(pdfPageValue))
      throw new Error("invalid PDF page");
    const result = this.db
      .prepare(
        `
      UPDATE studio_document_page_links
      SET pdf_page = ?, label = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(
        pdfPageValue,
        normalizeOptionalString(label),
        updatedAt ?? updated_at,
        id,
      );
    if (result.changes === 0) throw new Error("link not found");
  }

  unlinkStudioDocumentPage({ id }) {
    const result = this.db
      .prepare("DELETE FROM studio_document_page_links WHERE id = ?")
      .run(id);
    if (result.changes === 0) throw new Error("link not found");
  }

  studioPdfDestination(documentId) {
    const directory = path.join(
      this.appConfigDir,
      "studio-documents",
      safeStorageId(documentId),
    );
    ensurePrivateDirectory(directory);
    return path.join(directory, "source.pdf");
  }

  async importStudioDocument({
    documentId,
    document_id,
    notePageId,
    note_page_id,
    sourcePath,
    source_path,
    importedAt,
    imported_at,
  }) {
    const requestedDocumentId = documentId ?? document_id;
    const requestedNotePageId =
      notePageId ?? note_page_id ?? requestedDocumentId;
    const documentIdValue = this.isStudioPageUnified()
      ? requestedNotePageId
      : requestedDocumentId;
    const notePageIdValue = requestedNotePageId;
    const source = sourcePath ?? source_path;
    const imported = importedAt ?? imported_at;
    validatePageIdValue("document id", documentIdValue);
    validatePageIdValue("note page id", notePageIdValue);
    validatedPdfFile(source);
    const parsed = path.parse(source);
    const originalFilename = path.basename(source);
    const title = parsed.name || "Imported PDF";
    if (
      this.db
        .prepare("SELECT id FROM studio_documents WHERE id = ?")
        .get(documentIdValue)
    ) {
      throw new Error("document already exists");
    }
    if (
      this.db.prepare("SELECT id FROM pages WHERE id = ?").get(notePageIdValue)
    ) {
      throw new Error("note page already exists");
    }
    const destination = this.studioPdfDestination(documentIdValue);
    if (fs.existsSync(destination))
      throw new Error("Studio PDF destination already exists");
    const tempDestination = path.join(
      path.dirname(destination),
      `.source.${process.pid}.${Date.now()}.tmp`,
    );
    await fs.promises.copyFile(
      source,
      tempDestination,
      fs.constants.COPYFILE_EXCL,
    );
    fs.renameSync(tempDestination, destination);
    const storedFilePath = destination;

    try {
      this.withTransaction(() => {
        const pageTitle =
          documentIdValue === notePageIdValue ? title : `${title} Notes`;
        const pageKind =
          documentIdValue === notePageIdValue ? "note" : "studio_note";
        this.db
          .prepare(
            `
          INSERT INTO pages (${PAGE_COLUMNS})
          VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, ?, ?, ?)
        `,
          )
          .run(notePageIdValue, pageTitle, pageKind, imported, imported);
        this.db
          .prepare(
            `
          INSERT INTO studio_documents (id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 100, 1, 'pdf-left', ?, ?)
        `,
          )
          .run(
            documentIdValue,
            title,
            originalFilename,
            storedFilePath,
            notePageIdValue,
            imported,
            imported,
            imported,
          );
        this.db
          .prepare(
            `
          INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
          VALUES (?, ?, ?, NULL, 'Primary note', 0, ?, ?)
        `,
          )
          .run(
            crypto.randomUUID(),
            documentIdValue,
            notePageIdValue,
            imported,
            imported,
          );
      });
    } catch (error) {
      fs.rmSync(destination, { force: true });
      fs.rmSync(tempDestination, { force: true });
      throw error;
    }

    return this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(documentIdValue);
  }

  async replaceStudioDocumentFile({
    id,
    sourcePath,
    source_path,
    updatedAt,
    updated_at,
  }) {
    validatePageIdValue("document id", id);
    const current = this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(id);
    if (!current) throw new Error("document not found");
    const source = fs.realpathSync(sourcePath ?? source_path);
    validatedPdfFile(source);
    const destination = validateManagedStudioDocumentPath(
      current.stored_file_path,
      this.studioDocumentsRoot(),
    );
    const shouldCopy = fs.realpathSync(destination) !== source;
    if (shouldCopy) {
      const tempDestination = path.join(
        path.dirname(destination),
        `.source.${process.pid}.${Date.now()}.tmp`,
      );
      try {
        await fs.promises.copyFile(
          source,
          tempDestination,
          fs.constants.COPYFILE_EXCL,
        );
        fs.renameSync(tempDestination, destination);
      } catch (error) {
        fs.rmSync(tempDestination, { force: true });
        throw error;
      }
    }
    this.db
      .prepare(
        "UPDATE studio_documents SET original_filename = ?, stored_file_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(path.basename(source), destination, updatedAt ?? updated_at, id);
    return this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(id);
  }

  updateStudioDocumentViewerState({ id, updates, updatedAt, updated_at }) {
    const current = this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(id);
    if (!current) throw new Error("document not found");
    const viewerZoom = Math.max(
      25,
      Math.min(300, updates.viewer_zoom ?? current.viewer_zoom),
    );
    const viewerPage = Math.max(1, updates.viewer_page ?? current.viewer_page);
    const panelLayout =
      updates.panel_layout === "note-left" ||
      updates.panel_layout === "pdf-left"
        ? updates.panel_layout
        : current.panel_layout;
    const lastOpenedAt = updates.last_opened_at ?? current.last_opened_at;
    this.db
      .prepare(
        `
      UPDATE studio_documents
      SET viewer_zoom = ?, viewer_page = ?, panel_layout = ?, last_opened_at = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(
        viewerZoom,
        viewerPage,
        panelLayout,
        lastOpenedAt,
        updatedAt ?? updated_at,
        id,
      );
  }

  renameStudioDocument({ id, title, updatedAt, updated_at }) {
    const trimmed = String(title ?? "").trim();
    if (!trimmed) throw new Error("title cannot be empty");
    const current = this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(id);
    if (!current) throw new Error("document not found");
    const updated = updatedAt ?? updated_at;
    this.withTransaction(() => {
      this.db
        .prepare(
          "UPDATE studio_documents SET title = ?, updated_at = ? WHERE id = ?",
        )
        .run(trimmed, updated, id);
      const pageTitle =
        current.id === current.note_page_id ? trimmed : `${trimmed} Notes`;
      this.db
        .prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
        .run(pageTitle, updated, current.note_page_id);
    });
  }

  getStudioDocumentStoredFilePath(id) {
    const row = this.db
      .prepare("SELECT stored_file_path FROM studio_documents WHERE id = ?")
      .get(id);
    if (!row) throw new Error("document not found");
    return row.stored_file_path;
  }

  studioDocumentsRoot() {
    return path.join(this.appConfigDir, "studio-documents");
  }

  resolveStudioDocumentPdfPath(id) {
    return validateManagedStudioDocumentPath(
      this.getStudioDocumentStoredFilePath(id),
      this.studioDocumentsRoot(),
    );
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
    const current = this.db
      .prepare(
        `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
      )
      .get(id);
    if (!current) throw new Error("document not found");
    this.withTransaction(() => {
      this.db
        .prepare("DELETE FROM studio_document_page_links WHERE document_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM studio_documents WHERE id = ?").run(id);
      this.db
        .prepare(
          `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        DELETE FROM pages
        WHERE id IN (SELECT id FROM descendants)
      `,
        )
        .run(current.note_page_id);
    });
    removeStoredStudioDocumentFile(
      current.stored_file_path,
      this.studioDocumentsRoot(),
    );
  }

  toggleFavorite({ id, isFavorite, is_favorite }) {
    this.db
      .prepare(
        "UPDATE pages SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run((isFavorite ?? is_favorite) ? 1 : 0, id);
  }

  toggleTemplate({ id, isTemplate, is_template }) {
    this.db
      .prepare(
        "UPDATE pages SET is_template = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run((isTemplate ?? is_template) ? 1 : 0, id);
  }

  createPageFromTemplate({
    id,
    templateId,
    template_id,
    parentId,
    parent_id,
    createdAt,
    created_at,
  }) {
    const template = this.getPage({ id: templateId ?? template_id });
    if (!template) throw new Error("template not found");
    const parent = parentId ?? parent_id ?? null;
    const created = createdAt ?? created_at;
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `,
        )
        .get(parent, parent),
      "value",
    );
    this.db
      .prepare(
        `
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
    `,
      )
      .run(
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
        created,
      );
    return this.getPage({ id });
  }

  duplicatePage({ id, sourceId, source_id, createdAt, created_at }) {
    const source = this.getPage({ id: sourceId ?? source_id });
    if (!source) throw new Error("source page not found");
    const created = createdAt ?? created_at;
    const title = `Copy of ${source.title}`;
    const sortOrder = rowValue(
      this.db
        .prepare(
          `
      SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
      FROM pages
      WHERE is_deleted = 0
        AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
    `,
        )
        .get(source.parent_id, source.parent_id),
      "value",
    );
    this.db
      .prepare(
        `
      INSERT INTO pages (${PAGE_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
    `,
      )
      .run(
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
        created,
      );
    return this.getPage({ id });
  }

  readMetadataValue(key) {
    const row = this.db
      .prepare("SELECT value FROM app_metadata WHERE key = ?")
      .get(key);
    return row ? row.value : null;
  }

  writeMetadataValue(key, value) {
    if (value === null) {
      this.db.prepare("DELETE FROM app_metadata WHERE key = ?").run(key);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  getWorkspaceProfile() {
    return {
      name: this.readMetadataValue(PROFILE_METADATA_KEYS.name) || "",
      workspaceName:
        this.readMetadataValue(PROFILE_METADATA_KEYS.workspaceName) || "Shelf",
      avatarPath: this.readMetadataValue(PROFILE_METADATA_KEYS.avatarPath),
    };
  }

  updateWorkspaceProfile(args = {}) {
    if (args.name !== undefined) {
      if (
        typeof args.name !== "string" ||
        args.name.length > PROFILE_TEXT_MAX_LENGTH
      ) {
        throw new Error("profile name too long or invalid");
      }
      this.writeMetadataValue(PROFILE_METADATA_KEYS.name, args.name);
    }
    if (args.workspaceName !== undefined) {
      if (
        typeof args.workspaceName !== "string" ||
        args.workspaceName.length > PROFILE_TEXT_MAX_LENGTH
      ) {
        throw new Error("workspace name too long or invalid");
      }
      this.writeMetadataValue(
        PROFILE_METADATA_KEYS.workspaceName,
        args.workspaceName,
      );
    }
    if (args.avatarPath === null) {
      const avatarsDir = path.join(this.appConfigDir, "avatars");
      const existingPath = this.readMetadataValue(
        PROFILE_METADATA_KEYS.avatarPath,
      );
      if (existingPath) {
        try {
          const resolved = path.resolve(existingPath);
          if (
            resolved.startsWith(avatarsDir + path.sep) ||
            resolved === avatarsDir
          ) {
            fs.rmSync(resolved, { force: true });
          }
        } catch {
          // A failed delete must not fail the command.
        }
      }
      this.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, null);
    }
    return this.getWorkspaceProfile();
  }

  importProfileAvatar({ sourcePath, source_path }) {
    const source = sourcePath ?? source_path;
    const avatarsDir = path.join(this.appConfigDir, "avatars");
    ensurePrivateDirectory(avatarsDir);
    const extension = validatedCoverExtension(source, COVER_IMAGE_MAX_BYTES);
    const destination = path.join(
      avatarsDir,
      `profile-${Date.now()}.${extension}`,
    );
    const previousPath = this.readMetadataValue(
      PROFILE_METADATA_KEYS.avatarPath,
    );
    fs.copyFileSync(source, destination);
    this.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, destination);
    if (previousPath && previousPath !== destination) {
      try {
        const resolved = path.resolve(previousPath);
        if (
          resolved.startsWith(avatarsDir + path.sep) ||
          resolved === avatarsDir
        ) {
          fs.rmSync(resolved, { force: true });
        }
      } catch {
        // A failed delete must not fail the command.
      }
    }
    return destination;
  }

  importCoverImage({ sourcePath, source_path, pageId, page_id }) {
    const source = sourcePath ?? source_path;
    const pageIdValue = pageId ?? page_id;
    const coversDir = path.join(this.appConfigDir, "covers");
    ensurePrivateDirectory(coversDir);
    const extension = validatedCoverExtension(source, COVER_IMAGE_MAX_BYTES);
    const safePageId = String(pageIdValue ?? "").replace(/[^a-zA-Z0-9-]/g, "");
    const destination = path.join(
      coversDir,
      `${safePageId}-${Date.now()}.${extension}`,
    );
    fs.copyFileSync(source, destination);
    return destination;
  }

  importEditorImage({
    pageId,
    page_id,
    fileName,
    file_name,
    sourcePath,
    source_path,
    bytes,
  }) {
    const pageIdValue = pageId ?? page_id;
    const source = sourcePath ?? source_path;
    const sourceValue = source ? String(source) : null;
    const fileNameValue = fileName ?? file_name ?? "image";
    const imagesDir = path.join(
      this.appConfigDir,
      "editor-images",
      safeStorageId(pageIdValue),
    );
    ensurePrivateDirectory(imagesDir);
    const extension = sourceValue
      ? validatedEditorImageSource(sourceValue)
      : validatedEditorImageExtension(
          fileNameValue,
          Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []),
        );
    const destination = path.join(
      imagesDir,
      `${Date.now()}-${safeFileStem(sourceValue ? path.basename(sourceValue) : fileNameValue)}.${extension}`,
    );
    if (sourceValue) {
      fs.copyFileSync(sourceValue, destination);
    } else {
      fs.writeFileSync(
        destination,
        Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []),
      );
    }
    return destination;
  }

  importEditorVideo({
    pageId,
    page_id,
    fileName,
    file_name,
    sourcePath,
    source_path,
    bytes,
  }) {
    const pageIdValue = pageId ?? page_id;
    const source = sourcePath ?? source_path;
    const sourceValue = source ? String(source) : null;
    const fileNameValue = fileName ?? file_name ?? "video";
    const videosDir = path.join(
      this.appConfigDir,
      "editor-videos",
      safeStorageId(pageIdValue),
    );
    ensurePrivateDirectory(videosDir);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const extension = sourceValue
      ? validatedEditorVideoSource(sourceValue)
      : validatedEditorVideoExtension(fileNameValue, buffer);
    const destination = path.join(
      videosDir,
      `${Date.now()}-${safeFileStem(sourceValue ? path.basename(sourceValue) : fileNameValue)}.${extension}`,
    );
    if (sourceValue) {
      fs.copyFileSync(sourceValue, destination);
    } else {
      fs.writeFileSync(destination, buffer);
    }
    return destination;
  }
}

module.exports = {
  ShelfBackend,
  openDatabase,
  runMigrations,
  ensurePrivateDirectory,
  restrictDatabaseFilePermissions,
};
