const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { ShelfBackend } = require("./backend.cjs");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-electron-"));
const updateSigningKey = crypto.generateKeyPairSync("ed25519");
const updateManifestPublicKey = updateSigningKey.publicKey.export({ format: "pem", type: "spki" });
const backend = new ShelfBackend({ appConfigDir: tempRoot, updateManifestPublicKey });
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axL6wAAAABJRU5ErkJggg==",
  "base64"
);
const tinyPdfFixture = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9Sb290IDEgMCBSIC9TaXplIDQgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=",
  "base64"
);
const tinyMp4Header = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("unsupported signed manifest test value");
}

function signedUpdateManifest(payload) {
  return {
    signatureAlgorithm: "ed25519",
    payload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(payload), "utf8"), updateSigningKey.privateKey).toString("base64"),
  };
}

async function verifyLegacyStudioDocumentMigration(updateManifestPublicKey) {
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-legacy-studio-"));
  const legacyDb = new DatabaseSync(path.join(legacyRoot, "opennotion.db"));
  const createdAt = "2026-06-01T00:00:00.000Z";
  try {
    legacyDb.exec(`
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_metadata (key, value) VALUES ('schema_version', '2');

      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        title TEXT,
        parent_id TEXT,
        content TEXT,
        icon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        cover_url TEXT,
        search_text TEXT,
        is_deleted INTEGER DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        is_template INTEGER DEFAULT 0,
        is_database INTEGER DEFAULT 0,
        database_schema TEXT,
        properties TEXT,
        page_kind TEXT NOT NULL DEFAULT 'note'
      );
      CREATE TABLE studio_documents (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        stored_file_path TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        viewer_zoom INTEGER NOT NULL DEFAULT 100,
        viewer_page INTEGER NOT NULL DEFAULT 1,
        panel_layout TEXT NOT NULL DEFAULT 'pdf-left',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(id) REFERENCES pages(id) ON DELETE CASCADE
      );
      CREATE TABLE studio_document_page_links (
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
    legacyDb.prepare(`
      INSERT INTO pages (id, title, parent_id, content, icon, created_at, updated_at, page_kind)
      VALUES ('legacy-doc', 'Legacy PDF Notes', NULL, NULL, NULL, ?, ?, 'studio_note')
    `).run(createdAt, createdAt);
    legacyDb.prepare(`
      INSERT INTO studio_documents (id, original_filename, stored_file_path, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at)
      VALUES ('legacy-doc', 'legacy.pdf', '/tmp/legacy.pdf', ?, 100, 1, 'pdf-left', ?, ?)
    `).run(createdAt, createdAt, createdAt);
  } finally {
    legacyDb.close();
  }

  const legacyBackend = new ShelfBackend({ appConfigDir: legacyRoot, updateManifestPublicKey });
  try {
    const documents = await legacyBackend.invoke("list_studio_documents");
    assert.strictEqual(documents.length, 1);
    assert.strictEqual(documents[0].id, "legacy-doc");
    assert.strictEqual(documents[0].title, "Legacy PDF Notes");
    assert.strictEqual(documents[0].note_page_id, "legacy-doc");
    assert.strictEqual(documents[0].project_id, null);

    const links = await legacyBackend.invoke("list_studio_document_page_links", { documentId: "legacy-doc" });
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].page_id, "legacy-doc");
  } finally {
    legacyBackend.close();
  }
}

async function run() {
  const createdAt = "2026-06-03T00:00:00.000Z";
  await verifyLegacyStudioDocumentMigration(updateManifestPublicKey);

  const initialMigrationPreview = await backend.invoke("preview_studio_page_unification");
  if (initialMigrationPreview.schema_version !== "2") {
    throw new Error("new databases should start page-unified");
  }

  const page = await backend.invoke("create_page", {
    id: "page-1",
    title: "Smoke",
    parentId: null,
    createdAt,
  });

  if (page.id !== "page-1" || page.title !== "Smoke") {
    throw new Error("create_page returned wrong page");
  }

  await backend.invoke("update_page", {
    id: "page-1",
    updates: { content: "Hello Electron", search_text: "Hello Electron" },
    updatedAt: createdAt,
  });

  const results = await backend.invoke("search_pages", { query: "electron" });
  if (results.length !== 1 || results[0].id !== "page-1") {
    throw new Error("search_pages failed");
  }

  const emptyProfile = await backend.invoke("get_workspace_profile");
  assert.deepStrictEqual(emptyProfile, { name: "", workspaceName: "Shelf", avatarPath: null });

  await backend.invoke("update_workspace_profile", { name: "Marco", workspaceName: "Studio Marco" });
  const updatedProfile = await backend.invoke("get_workspace_profile");
  assert.strictEqual(updatedProfile.name, "Marco");
  assert.strictEqual(updatedProfile.workspaceName, "Studio Marco");

  await assert.rejects(
    backend.invoke("update_workspace_profile", { name: "x".repeat(500) }),
    /too long|invalid/,
  );

	  const avatarSource = path.join(tempRoot, "avatar-source.png");
	  fs.writeFileSync(avatarSource, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
	  await assert.rejects(
	    backend.invoke("import_profile_avatar", { sourcePath: avatarSource }),
	    /trusted file dialog/,
	  );
	  const avatarPath = backend.importProfileAvatar({ sourcePath: avatarSource });
  assert.ok(avatarPath.includes("avatars"));
  assert.ok(fs.existsSync(avatarPath));
  assert.strictEqual((await backend.invoke("get_workspace_profile")).avatarPath, avatarPath);

  // Importing a second avatar must delete the first one (finding 1: orphan cleanup).
  // Sleep 2ms so the Date.now() timestamp in the destination filename differs from the first.
	  await new Promise((resolve) => setTimeout(resolve, 2));
	  const avatarSource2 = path.join(tempRoot, "avatar-source2.png");
	  fs.writeFileSync(avatarSource2, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
	  const avatarPath2 = backend.importProfileAvatar({ sourcePath: avatarSource2 });
  assert.ok(fs.existsSync(avatarPath2), "second avatar must exist on disk");
  assert.ok(!fs.existsSync(avatarPath), "first avatar must be deleted after replacement");

  await backend.invoke("update_workspace_profile", { avatarPath: null });
  assert.strictEqual((await backend.invoke("get_workspace_profile")).avatarPath, null);
  assert.ok(!fs.existsSync(avatarPath2), "avatar file must be deleted when cleared via update_workspace_profile");

	  const backupPath = path.join(tempRoot, "backup.json");
	  await assert.rejects(
	    backend.invoke("export_backup", { path: backupPath, exportedAt: createdAt }),
	    /trusted file dialog/,
	  );
	  const exported = backend.exportBackup({ path: backupPath, exportedAt: createdAt });
  if (exported !== 1 || !fs.existsSync(backupPath)) {
    throw new Error("export_backup failed");
  }

  const backupJson = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  assert.strictEqual(backupJson.profile.workspaceName, "Studio Marco");

  // Reset to defaults so the restore path in import_backup is exercised.
  await backend.invoke("update_workspace_profile", { name: "", workspaceName: "Shelf" });
  assert.strictEqual((await backend.invoke("get_workspace_profile")).workspaceName, "Shelf");

	  await backend.invoke("delete_page", { id: "page-1" });
	  await assert.rejects(
	    backend.invoke("import_backup", { path: backupPath, importedAt: createdAt }),
	    /trusted file dialog/,
	  );
	  const imported = backend.importBackup({ path: backupPath, importedAt: createdAt });
  if (imported !== 1) {
    throw new Error("import_backup failed");
  }

  // The backup restore path must have applied the saved profile.
  assert.strictEqual((await backend.invoke("get_workspace_profile")).workspaceName, "Studio Marco",
    "import_backup must restore workspaceName from backup when profile is at defaults");

  const pages = await backend.invoke("list_pages");
  if (pages.length !== 1 || pages[0].title !== "Smoke") {
    throw new Error("list_pages after import failed");
  }

	  const editorImagePath = await backend.invoke("import_editor_image", {
    pageId: "page-1",
    fileName: "inline.png",
    bytes: Array.from(onePixelPng),
  });
	  if (!fs.existsSync(editorImagePath)) {
	    throw new Error("import_editor_image did not write file");
	  }
	  await assert.rejects(
	    backend.invoke("import_editor_image", { pageId: "page-1", sourcePath: avatarSource }),
	    /trusted file dialog/,
	  );

  const editorVideoPath = await backend.invoke("import_editor_video", {
    pageId: "page-1",
    fileName: "inline.mp4",
    bytes: Array.from(tinyMp4Header),
  });
  if (!fs.existsSync(editorVideoPath)) {
    throw new Error("import_editor_video did not write file");
  }

  await backend.invoke("create_page", {
    id: "linked-page",
    title: "Linked page",
    parentId: null,
    createdAt,
  });

	  const pdfPath = path.join(tempRoot, "source.pdf");
	  fs.writeFileSync(pdfPath, tinyPdfFixture);
	  await assert.rejects(
	    backend.invoke("import_studio_document", {
	      documentId: "studio-note-1",
	      notePageId: "studio-note-1",
	      sourcePath: pdfPath,
	      importedAt: createdAt,
	    }),
	    /trusted file dialog/,
	  );
	  await backend.importStudioDocument({
	    documentId: "studio-note-1",
	    notePageId: "studio-note-1",
	    sourcePath: pdfPath,
    importedAt: createdAt,
  });
  await backend.invoke("create_studio_project", {
    id: "project-1",
    name: "Cases",
    parentId: null,
    createdAt,
  });
  await backend.invoke("update_studio_document_project", {
    id: "studio-note-1",
    projectId: "project-1",
    updatedAt: createdAt,
  });

  const primaryLinks = await backend.invoke("list_studio_document_page_links", { documentId: "studio-note-1" });
  if (
    primaryLinks.length !== 2 ||
    !primaryLinks.some((link) => link.page_id === "studio-note-1") ||
    !primaryLinks.some((link) => link.page.title === "source Notes")
  ) {
    throw new Error("studio primary page link failed");
  }

  const linked = await backend.invoke("link_studio_document_page", {
    id: "doc-link-1",
    documentId: "studio-note-1",
    pageId: "linked-page",
    pdfPage: 3,
    label: "p. 3",
    createdAt,
  });
  if (linked.page_id !== "linked-page" || linked.pdf_page !== 3 || linked.page.title !== "Linked page") {
    throw new Error("link_studio_document_page failed");
  }

  const studioLinks = await backend.invoke("list_studio_document_page_links", { documentId: "studio-note-1" });
  if (studioLinks.length !== 3 || !studioLinks.some((link) => link.page_id === "linked-page" && link.pdf_page === 3)) {
    throw new Error("list_studio_document_page_links failed");
  }

  const allStudioLinks = await backend.invoke("list_all_studio_document_page_links");
  if (allStudioLinks.length !== 3 || !allStudioLinks.some((link) => link.document_id === "studio-note-1" && link.page_id === "linked-page")) {
    throw new Error("list_all_studio_document_page_links failed");
  }

  const migrationPreview = await backend.invoke("preview_studio_page_unification");
  if (
    !migrationPreview.can_migrate ||
    migrationPreview.project_count !== 1 ||
    migrationPreview.document_count !== 1 ||
    migrationPreview.link_count !== 3 ||
    migrationPreview.linked_regular_page_count !== 3 ||
    migrationPreview.linked_studio_note_count !== 0 ||
    migrationPreview.blockers.length !== 0
  ) {
    throw new Error("preview_studio_page_unification failed");
  }

  const migratedPreview = await backend.invoke("migrate_studio_page_unification", { migratedAt: createdAt });
  if (!migratedPreview.can_migrate || migratedPreview.schema_version !== "2") {
    throw new Error("migrate_studio_page_unification failed");
  }
  const migratedDocuments = await backend.invoke("list_studio_documents");
  if (migratedDocuments.length !== 1 || migratedDocuments[0].id !== "studio-note-1" || migratedDocuments[0].note_page_id !== "studio-note-1") {
    throw new Error("migrate_studio_page_unification did not promote primary note id");
  }
  const migratedPrimaryPage = await backend.invoke("get_page", { id: "studio-note-1" });
  if (!migratedPrimaryPage || migratedPrimaryPage.page_kind !== "note" || migratedPrimaryPage.title !== "source" || migratedPrimaryPage.parent_id !== "studio-project:project-1") {
    throw new Error("migrate_studio_page_unification did not promote primary note page");
  }
  const migratedProjectPage = await backend.invoke("get_page", { id: "studio-project:project-1" });
  if (!migratedProjectPage || migratedProjectPage.title !== "Cases") {
    throw new Error("migrate_studio_page_unification did not mirror Studio project");
  }
  const migratedLinks = await backend.invoke("list_studio_document_page_links", { documentId: "studio-note-1" });
  if (
    migratedLinks.length !== 3 ||
    !migratedLinks.some((link) => link.page_id === "linked-page") ||
    !migratedLinks.some((link) => link.page.title === "source Notes")
  ) {
    throw new Error("migrate_studio_page_unification did not rewrite document links");
  }
  const reopenedBackend = new ShelfBackend({ appConfigDir: tempRoot, updateManifestPublicKey });
  try {
    const reopenedPreview = await reopenedBackend.invoke("preview_studio_page_unification");
    if (reopenedPreview.schema_version !== "2") {
      throw new Error("runMigrations downgraded page unification schema");
    }
  } finally {
    reopenedBackend.close();
  }

  await backend.invoke("unlink_studio_document_page", { id: "doc-link-1" });
  const remainingStudioLinks = await backend.invoke("list_studio_document_page_links", { documentId: "studio-note-1" });
  if (remainingStudioLinks.some((link) => link.id === "doc-link-1")) {
    throw new Error("unlink_studio_document_page failed");
  }
  const linkedPageAfterUnlink = await backend.invoke("get_page", { id: "linked-page" });
  if (!linkedPageAfterUnlink) {
    throw new Error("unlink_studio_document_page deleted the linked page");
  }
  try {
    await backend.invoke("delete_page", { id: "studio-note-1" });
    throw new Error("delete_page accepted a Studio primary note");
  } catch (error) {
    if (!String(error?.message || error).includes("Studio document")) {
      throw error;
    }
  }

  await backend.invoke("open_external_url", { url: "https://github.com/marcoodignoti/Shelf" });
  try {
    await backend.invoke("open_external_url", { url: "http://example.com" });
    throw new Error("open_external_url accepted non-HTTPS URL");
  } catch (error) {
    if (!String(error?.message || error).includes("external URL must use HTTPS")) {
      throw error;
    }
  }

  try {
    await backend.invoke("fetch_update_manifest", { url: "http://example.com/beta-update.json" });
    throw new Error("fetch_update_manifest accepted non-HTTPS URL");
  } catch (error) {
    if (!String(error?.message || error).includes("update manifest URL must use HTTPS")) {
      throw error;
    }
  }

  const assetRoot = path.join(tempRoot, "covers");
  const assetPath = path.join(assetRoot, "cover.png");
  fs.mkdirSync(assetRoot, { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from("managed asset"));
  const assetUrl = backend.fileSrc(assetPath);
  if (!assetUrl.startsWith("opennotion-app://asset/") || assetUrl.startsWith("file://")) {
    throw new Error("fileSrc did not use the app asset protocol");
  }
  if (backend.resolveManagedAssetPath(new URL(assetUrl).pathname.slice(1)) !== fs.realpathSync(assetPath)) {
    throw new Error("app asset protocol token did not resolve to the managed file");
  }

	  const updateBytes = Buffer.from("verified update artifact");
	  const updateSha256 = crypto.createHash("sha256").update(updateBytes).digest("hex");
	  const updateUrl = "https://github.com/marcoodignoti/Shelf/releases/download/v99.0.0/Shelf_99.0.0_arm64.dmg";
	  const portableUpdateUrl = "https://github.com/marcoodignoti/Shelf/releases/download/v99.0.0/Shelf_99.0.0_win-x64.zip";
	  const installerUpdateUrl = "https://github.com/marcoodignoti/Shelf/releases/download/v99.0.0/Shelf_99.0.0_setup_win-x64.exe";
	  const updateManifestUrl = "https://github.com/marcoodignoti/Shelf/releases/download/beta/beta-update.json";
	  const manifestPayload = {
	    version: "99.0.0",
	    channel: "beta",
    publishedAt: "2026-06-05T00:00:00.000Z",
    title: "Shelf 99.0.0",
    summary: "Signed update manifest.",
	    changes: ["Signed manifest"],
	    downloads: {
	      macosArm64: { url: updateUrl, label: "macOS Apple Silicon", sha256: updateSha256 },
	      windowsX64: { url: portableUpdateUrl, label: "Windows x64", sha256: updateSha256 },
	      windowsInstallerX64: { url: installerUpdateUrl, label: "Windows x64 installer", sha256: updateSha256 },
	    },
	  };
	  let verifiedManifest;
	  const originalManifestFetch = global.fetch;
	  try {
	    global.fetch = async () => new Response(JSON.stringify(signedUpdateManifest(manifestPayload)), {
	      status: 200,
	      headers: { "content-length": "512" },
	    });
	    verifiedManifest = await backend.invoke("fetch_update_manifest", { url: updateManifestUrl });
	    if (verifiedManifest.version !== manifestPayload.version) {
	      throw new Error("fetch_update_manifest did not return verified payload");
	    }
	    if (!verifiedManifest.downloads.macosArm64.downloadToken || !verifiedManifest.downloads.windowsInstallerX64.downloadToken) {
	      throw new Error("fetch_update_manifest did not issue download tokens");
	    }

    let rejectedBadSignature = false;
    try {
      global.fetch = async () => {
        const manifest = signedUpdateManifest(manifestPayload);
        manifest.signature = "bad";
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "content-length": "512" },
        });
      };
      await backend.invoke("fetch_update_manifest", { url: updateManifestUrl });
    } catch (error) {
      if (!String(error?.message || error).includes("signature")) throw error;
      rejectedBadSignature = true;
    }
    if (!rejectedBadSignature) throw new Error("fetch_update_manifest accepted bad signature");
	  } finally {
	    global.fetch = originalManifestFetch;
	  }

	  const originalFetch = global.fetch;
	  let openedUpdatePath = null;
  global.fetch = async () => new Response(updateBytes, {
    status: 200,
    headers: { "content-length": String(updateBytes.length) },
  });
  backend.openPath = async (filePath) => {
    openedUpdatePath = filePath;
    return "";
  };

	  const verifiedUpdate = await backend.invoke("download_update_artifact", {
	    url: updateUrl,
	    sha256: updateSha256,
	    downloadToken: verifiedManifest.downloads.macosArm64.downloadToken,
	  });
  if (verifiedUpdate.sha256 !== updateSha256 || !fs.existsSync(verifiedUpdate.path) || openedUpdatePath !== verifiedUpdate.path) {
    throw new Error("download_update_artifact failed verified download");
  }

	  const verifiedInstallerUpdate = await backend.invoke("download_update_artifact", {
	    url: installerUpdateUrl,
	    sha256: updateSha256,
	    downloadToken: verifiedManifest.downloads.windowsInstallerX64.downloadToken,
	  });
  if (!verifiedInstallerUpdate.path.endsWith(".exe")) {
    throw new Error("download_update_artifact rejected Windows installer");
  }

	  try {
	    await backend.invoke("download_update_artifact", {
	      url: updateUrl,
	      sha256: updateSha256,
	    });
	    throw new Error("download_update_artifact accepted missing token");
	  } catch (error) {
	    if (!String(error?.message || error).includes("verified manifest")) {
	      throw error;
	    }
	  }

	  global.fetch = async () => new Response(Buffer.from("tampered update artifact"), {
	    status: 200,
	    headers: { "content-length": "24" },
	  });
	  try {
	    await backend.invoke("download_update_artifact", {
	      url: portableUpdateUrl,
	      sha256: updateSha256,
	      downloadToken: verifiedManifest.downloads.windowsX64.downloadToken,
	    });
	    throw new Error("download_update_artifact accepted bad checksum");
	  } catch (error) {
	    if (!String(error?.message || error).includes("checksum mismatch")) {
	      throw error;
	    }
	  } finally {
	    global.fetch = originalFetch;
	  }

  await verifyVersionChangeBackups();
}

async function verifyVersionChangeBackups() {
  const { openDatabase } = require("./backend.cjs");
  const backupConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-backup-smoke-"));
  const backupsDir = path.join(backupConfigDir, "backups");
  const countBackups = () =>
    fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((name) => name.endsWith(".db")).length : 0;

  try {
    // Fresh database: no backup, version recorded.
    openDatabase(backupConfigDir, "1.0.0").close();
    if (countBackups() !== 0) throw new Error("backup was created for a fresh database");

    // Same version relaunch: still no backup.
    openDatabase(backupConfigDir, "1.0.0").close();
    if (countBackups() !== 0) throw new Error("backup was created without a version change");

    // Version change: exactly one pre-migration backup.
    const upgraded = openDatabase(backupConfigDir, "1.1.0");
    const storedVersion = upgraded
      .prepare("SELECT value FROM app_metadata WHERE key = 'app_version'")
      .get();
    upgraded.close();
    if (countBackups() !== 1) throw new Error("version change did not create exactly one backup");
    if (!storedVersion || storedVersion.value !== "1.1.0") {
      throw new Error("app_version was not updated after migration");
    }
    const backupName = fs.readdirSync(backupsDir).find((name) => name.endsWith(".db"));
    if (!backupName.startsWith("shelf-v1.0.0-")) {
      throw new Error(`backup name does not record the previous version: ${backupName}`);
    }

    // Old backups beyond the retention window are pruned.
    for (let minor = 2; minor <= 9; minor += 1) {
      openDatabase(backupConfigDir, `1.${minor}.0`).close();
    }
    if (countBackups() > 5) throw new Error("backup retention did not prune old backups");
  } finally {
    fs.rmSync(backupConfigDir, { recursive: true, force: true });
  }
}

run()
  .finally(() => {
    backend.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
