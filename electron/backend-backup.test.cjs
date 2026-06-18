const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PROFILE_METADATA_KEYS } = require("./backend-helpers.cjs");

function pageRecord(id, title) {
  return {
    id,
    title,
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

test("backup backend exports pages and imports backup content through context hooks", () => {
  const { createBackupBackend } = require("./backend-backup.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-backup-"));
  const backupPath = path.join(dataDir, "backup.json");
  const metadataWrites = [];
  const importedBatches = [];
  const backup = createBackupBackend({
    listAllPages: () => [pageRecord("page-1", "Exported")],
    getWorkspaceProfile: () => ({ name: "", workspaceName: "Shelf" }),
    importPageRecords: (pages, options) => {
      importedBatches.push({ pages, options });
      return pages.length;
    },
    writeMetadataValue: (key, value) => metadataWrites.push([key, value]),
    withTransaction: (work) => work(),
  });

  try {
    const exportedCount = backup.exportBackup({
      path: backupPath,
      exportedAt: "2026-01-01T00:00:01.000Z",
    });
    assert.equal(exportedCount, 1);
    const exported = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    assert.equal(exported.profile.workspaceName, "Shelf");
    assert.equal(exported.pages[0].title, "Exported");

    const importedPage = pageRecord("source-page", "Imported");
    importedPage.cover_url = "https://tracker.example/pixel.png";
    importedPage.content = JSON.stringify([
      {
        type: "image",
        props: { url: "file:///Users/example/secret.png" },
        children: [],
      },
    ]);

    const importedCount = backup.importBackupContent({
      content: JSON.stringify({
        version: 1,
        exported_at: "2026-01-01T00:00:02.000Z",
        profile: { name: "Marco", workspaceName: "Research" },
        pages: [importedPage],
      }),
      importedAt: "2026-01-01T00:00:03.000Z",
    });

    assert.equal(importedCount, 1);
    assert.equal(importedBatches.length, 1);
    assert.equal(importedBatches[0].options.inTransaction, true);
    assert.equal(importedBatches[0].pages[0].title, "Imported");
    assert.equal(importedBatches[0].pages[0].cover_url, null);
    assert.deepEqual(JSON.parse(importedBatches[0].pages[0].content)[0].props, {});
    assert.equal(importedBatches[0].pages[0].created_at, "2026-01-01T00:00:03.000Z");
    assert.deepEqual(metadataWrites, [
      [PROFILE_METADATA_KEYS.name, "Marco"],
      [PROFILE_METADATA_KEYS.workspaceName, "Research"],
    ]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
