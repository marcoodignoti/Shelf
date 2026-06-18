const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("./backend-helpers.cjs");

function insertPage(db, id, title, createdAt = "2026-01-01T00:00:00.000Z") {
  db.prepare(
    `
    INSERT INTO pages (
      id, title, parent_id, content, search_text, icon, cover_url,
      is_deleted, is_favorite, is_template, is_database,
      database_schema, properties, sort_order, page_kind, created_at, updated_at
    )
    VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'note', ?, ?)
  `,
  ).run(id, title, createdAt, createdAt);
}

function insertDocument(
  db,
  id,
  notePageId,
  createdAt = "2026-01-01T00:00:00.000Z",
) {
  db.prepare(
    `
    INSERT INTO studio_documents (
      id, title, original_filename, stored_file_path, note_page_id,
      project_id, last_opened_at, viewer_zoom, viewer_page, panel_layout,
      created_at, updated_at
    )
    VALUES (?, 'Document', 'document.pdf', 'studio-documents/document/source.pdf', ?, NULL, ?, 100, 1, 'pdf-left', ?, ?)
  `,
  ).run(id, notePageId, createdAt, createdAt, createdAt);
}

test("Studio link backend manages document page links without ShelfBackend", () => {
  const { createStudioLinkBackend } = require("./backend-studio-links.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-studio-links-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const studioLinks = createStudioLinkBackend({ db });

  try {
    insertPage(db, "doc-note", "Document note");
    insertPage(db, "linked-note", "Linked note");
    insertDocument(db, "doc", "doc-note");

    const created = studioLinks.linkStudioDocumentPage({
      id: "link-1",
      documentId: "doc",
      pageId: "linked-note",
      pdfPage: 2.6,
      label: "  Research  ",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    assert.equal(created.id, "link-1");
    assert.equal(created.document_id, "doc");
    assert.equal(created.page_id, "linked-note");
    assert.equal(created.pdf_page, 3);
    assert.equal(created.label, "  Research  ");
    assert.equal(created.page.title, "Linked note");
    assert.equal(created.page.content, null);

    const listed = studioLinks.listStudioDocumentPageLinks({
      documentId: "doc",
    });
    assert.deepEqual(
      listed.map((link) => link.id),
      ["link-1"],
    );

    studioLinks.updateStudioDocumentPageLink({
      id: "link-1",
      pdfPage: "",
      label: "",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const updated = studioLinks.listAllStudioDocumentPageLinks()[0];
    assert.equal(updated.pdf_page, null);
    assert.equal(updated.label, "");

    const upserted = studioLinks.linkStudioDocumentPage({
      id: "link-2",
      document_id: "doc",
      page_id: "linked-note",
      pdf_page: 9,
      label: "Updated",
      created_at: "2026-01-01T00:00:03.000Z",
    });
    assert.equal(upserted.id, "link-1");
    assert.equal(upserted.pdf_page, 9);
    assert.equal(upserted.label, "Updated");

    studioLinks.unlinkStudioDocumentPage({ id: "link-1" });
    assert.deepEqual(studioLinks.listStudioDocumentPageLinks({ documentId: "doc" }), []);

    assert.throws(
      () =>
        studioLinks.linkStudioDocumentPage({
          documentId: "missing",
          pageId: "linked-note",
          createdAt: "2026-01-01T00:00:04.000Z",
        }),
      /document not found/,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
