const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("./backend-helpers.cjs");

function withTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertPage(db, id, title, parentId = null) {
  db.prepare(
    `
    INSERT INTO pages (
      id, title, parent_id, content, search_text, icon, cover_url,
      is_deleted, is_favorite, is_template, is_database,
      database_schema, properties, sort_order, page_kind, created_at, updated_at
    )
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'note', ?, ?)
  `,
  ).run(
    id,
    title,
    parentId,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
}

function indexedPageIds(db, query) {
  return db
    .prepare(
      `
      SELECT page_id
      FROM page_search_fts
      WHERE page_search_fts MATCH ?
      ORDER BY page_id
    `,
    )
    .all(query)
    .map((row) => row.page_id);
}

test("Studio document backend keeps note pages in the search index", async () => {
  const {
    createStudioDocumentBackend,
  } = require("./backend-studio-documents.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-studio-docs-search-"));
  const sourcePdf = path.join(dataDir, "Searchable Alpha.pdf");
  const db = openDatabase(dataDir, "0.0.1-test");
  const studioDocuments = createStudioDocumentBackend({
    appConfigDir: dataDir,
    db,
    openPath: async () => "",
    revealPath: () => {},
    withTransaction: (work) => withTransaction(db, work),
    isStudioPageUnified: () => true,
  });

  try {
    fs.writeFileSync(sourcePdf, "%PDF-1.4\n");

    await studioDocuments.importStudioDocument({
      documentId: "ignored-doc-id",
      notePageId: "doc-note",
      sourcePath: sourcePdf,
      importedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(indexedPageIds(db, "searchable*"), ["doc-note"]);

    studioDocuments.renameStudioDocument({
      id: "doc-note",
      title: "Renamed Beta",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    assert.deepEqual(indexedPageIds(db, "searchable*"), []);
    assert.deepEqual(indexedPageIds(db, "renamed*"), ["doc-note"]);

    studioDocuments.deleteStudioDocument({ id: "doc-note" });
    assert.deepEqual(indexedPageIds(db, "renamed*"), []);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Studio document backend updates, opens, reveals, and deletes managed documents", async () => {
  const {
    createStudioDocumentBackend,
  } = require("./backend-studio-documents.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-studio-docs-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const storedDir = path.join(dataDir, "studio-documents", "doc");
  const storedPath = path.join(storedDir, "source.pdf");
  const openedPaths = [];
  const revealedPaths = [];
  const studioDocuments = createStudioDocumentBackend({
    appConfigDir: dataDir,
    db,
    openPath: async (filePath) => {
      openedPaths.push(filePath);
      return "";
    },
    revealPath: (filePath) => {
      revealedPaths.push(filePath);
    },
    withTransaction: (work) => withTransaction(db, work),
    isStudioPageUnified: () => true,
    mirrorStudioDocumentPageParent: () => {},
  });

  try {
    fs.mkdirSync(storedDir, { recursive: true });
    fs.writeFileSync(storedPath, "%PDF-1.4\n");
    insertPage(db, "note", "Original note");
    insertPage(db, "child", "Child note", "note");
    db.prepare(
      `
      INSERT INTO studio_documents (
        id, title, original_filename, stored_file_path, note_page_id,
        project_id, last_opened_at, viewer_zoom, viewer_page, panel_layout,
        created_at, updated_at
      )
      VALUES (?, 'Original', 'original.pdf', ?, 'note', NULL, ?, 100, 1, 'pdf-left', ?, ?)
    `,
    ).run(
      "doc",
      storedPath,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    studioDocuments.updateStudioDocumentViewerState({
      id: "doc",
      updates: {
        viewer_zoom: 999,
        viewer_page: -3,
        panel_layout: "bad-layout",
        last_opened_at: "2026-01-01T00:00:01.000Z",
      },
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const viewed = db
      .prepare(
        "SELECT viewer_zoom, viewer_page, panel_layout, last_opened_at FROM studio_documents WHERE id = ?",
      )
      .get("doc");
    assert.equal(viewed.viewer_zoom, 300);
    assert.equal(viewed.viewer_page, 1);
    assert.equal(viewed.panel_layout, "pdf-left");
    assert.equal(viewed.last_opened_at, "2026-01-01T00:00:01.000Z");

    studioDocuments.renameStudioDocument({
      id: "doc",
      title: "Renamed",
      updatedAt: "2026-01-01T00:00:03.000Z",
    });
    assert.equal(
      db.prepare("SELECT title FROM studio_documents WHERE id = ?").get("doc")
        .title,
      "Renamed",
    );
    assert.equal(
      db.prepare("SELECT title FROM pages WHERE id = ?").get("note").title,
      "Renamed Notes",
    );

    await studioDocuments.openStudioDocumentFile({ id: "doc" });
    studioDocuments.revealStudioDocumentFile({ id: "doc" });
    const resolvedStoredPath = fs.realpathSync(storedPath);
    assert.deepEqual(openedPaths, [resolvedStoredPath]);
    assert.deepEqual(revealedPaths, [resolvedStoredPath]);

    studioDocuments.deleteStudioDocument({ id: "doc" });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS value FROM studio_documents").get().value,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS value FROM pages").get().value,
      0,
    );
    assert.equal(fs.existsSync(storedPath), false);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
