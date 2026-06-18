const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION,
  openDatabase,
  studioProjectPageId,
} = require("./backend-helpers.cjs");
const {
  createStudioProjectBackend,
} = require("./backend-studio-projects.cjs");

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

function insertPage(db, id, title, pageKind = "studio_note") {
  db.prepare(
    `
    INSERT INTO pages (
      id, title, parent_id, content, search_text, icon, cover_url,
      is_deleted, is_favorite, is_template, is_database,
      database_schema, properties, sort_order, page_kind, created_at, updated_at
    )
    VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, ?, ?, ?)
  `,
  ).run(
    id,
    title,
    pageKind,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
}

test("Studio unification backend migrates legacy document ids into the page tree", () => {
  const {
    createStudioUnificationBackend,
  } = require("./backend-studio-unification.cjs");
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "shelf-studio-unification-"),
  );
  const db = openDatabase(dataDir, "0.0.1-test");
  const context = {
    db,
    withTransaction: (work) => withTransaction(db, work),
  };
  Object.assign(
    context,
    createStudioUnificationBackend(context),
    createStudioProjectBackend(context),
  );

  try {
    db.prepare("UPDATE app_metadata SET value = ? WHERE key = 'schema_version'")
      .run("1");
    insertPage(db, "note", "Legacy note");
    db.prepare(
      "INSERT INTO studio_projects (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)",
    ).run(
      "project",
      "Project",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare(
      `
      INSERT INTO studio_documents (
        id, title, original_filename, stored_file_path, note_page_id,
        project_id, last_opened_at, viewer_zoom, viewer_page, panel_layout,
        created_at, updated_at
      )
      VALUES (?, 'Paper', 'paper.pdf', 'studio-documents/doc/source.pdf', 'note', 'project', ?, 100, 1, 'pdf-left', ?, ?)
    `,
    ).run(
      "doc",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO studio_document_page_links (id, document_id, page_id, pdf_page, label, sort_order, created_at, updated_at) VALUES (?, ?, ?, NULL, 'Primary note', 0, ?, ?)",
    ).run(
      "primary-link",
      "doc",
      "note",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    const before = context.previewStudioPageUnification();
    assert.equal(before.can_migrate, true);
    assert.equal(before.schema_version, "1");

    const after = context.migrateStudioPageUnification({
      migratedAt: "2026-01-01T00:00:01.000Z",
    });
    assert.equal(after.schema_version, STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION);
    assert.equal(context.isStudioPageUnified(), true);

    const document = db
      .prepare("SELECT id, note_page_id, project_id FROM studio_documents")
      .get();
    assert.equal(document.id, "note");
    assert.equal(document.note_page_id, "note");
    assert.equal(document.project_id, "project");
    const page = db
      .prepare("SELECT title, parent_id, page_kind FROM pages WHERE id = ?")
      .get("note");
    assert.equal(page.title, "Paper");
    assert.equal(page.parent_id, studioProjectPageId("project"));
    assert.equal(page.page_kind, "note");
    const projectPage = db
      .prepare("SELECT title, page_kind FROM pages WHERE id = ?")
      .get(studioProjectPageId("project"));
    assert.equal(projectPage.title, "Project");
    assert.equal(projectPage.page_kind, "project");
    assert.equal(
      db
        .prepare("SELECT document_id FROM studio_document_page_links WHERE id = ?")
        .get("primary-link").document_id,
      "note",
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS value FROM studio_documents_backup_page_unification",
        )
        .get().value,
      1,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
