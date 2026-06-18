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

test("Studio project backend mirrors nested projects into unified page tree", () => {
  const { createStudioProjectBackend } = require("./backend-studio-projects.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-studio-projects-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  db.prepare("UPDATE app_metadata SET value = ? WHERE key = 'schema_version'")
    .run(STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION);
  const studioProjects = createStudioProjectBackend({
    db,
    withTransaction: (work) => withTransaction(db, work),
    isStudioPageUnified: () => true,
  });

  try {
    const parent = studioProjects.createStudioProject({
      id: "parent",
      name: "Parent",
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    studioProjects.createStudioProject({
      id: "child",
      name: "Child",
      parentId: parent.id,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    studioProjects.renameStudioProject({
      id: "child",
      name: "Renamed",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    const mirroredChild = db
      .prepare("SELECT id, title, parent_id, page_kind FROM pages WHERE id = ?")
      .get(studioProjectPageId("child"));

    assert.equal(mirroredChild.title, "Renamed");
    assert.equal(mirroredChild.parent_id, studioProjectPageId("parent"));
    assert.equal(mirroredChild.page_kind, "project");
    assert.throws(
      () =>
        studioProjects.updateStudioProjectParent({
          id: "parent",
          parentId: "child",
          updatedAt: "2026-01-01T00:00:03.000Z",
        }),
      /project cycle not allowed/,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
