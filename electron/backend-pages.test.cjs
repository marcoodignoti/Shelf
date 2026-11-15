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

test("page backend module creates, updates, moves, and lists pages", () => {
  const { createPageBackend } = require("./backend-pages.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-pages-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const pages = createPageBackend({
    appConfigDir: dataDir,
    db,
    withTransaction: (work) => withTransaction(db, work),
  });

  try {
    const root = pages.createPage({
      id: "root",
      title: "Root",
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const child = pages.createPage({
      id: "child",
      title: "Child",
      parentId: null,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    pages.movePage({
      id: child.id,
      parentId: root.id,
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    pages.updatePage({
      id: child.id,
      updates: { title: "Moved child" },
      updatedAt: "2026-01-01T00:00:03.000Z",
    });
    pages.updatePage({
      id: child.id,
      updates: { content: JSON.stringify([{ type: "paragraph", content: "Heavy note body" }]) },
      updatedAt: "2026-01-01T00:00:03.500Z",
    });
    pages.updatePage({
      id: child.id,
      updates: { cover_url: " data:image/png;base64,abc " },
      updatedAt: "2026-01-01T00:00:04.000Z",
    });

    const listedChild = pages.listPages().find((page) => page.id === child.id);
    assert.equal(pages.listPages().length, 2);
    assert.equal(listedChild.content, null);
    assert.equal(listedChild.search_text, null);
    assert.equal(listedChild.content_loaded, 0);
    assert.equal(pages.getPage({ id: child.id }).parent_id, root.id);
    assert.equal(pages.getPage({ id: child.id }).title, "Moved child");
    assert.equal(pages.getPage({ id: child.id }).cover_url, "data:image/png;base64,abc");
    assert.match(pages.getPage({ id: child.id }).content, /Heavy note body/);
    assert.equal(pages.getPage({ id: child.id }).content_loaded, 1);

    const searchByBody = pages.searchPages({ query: "Heavy" });
    assert.equal(searchByBody.length, 1);
    assert.equal(searchByBody[0].id, child.id);
    assert.equal(searchByBody[0].content, null);
    assert.equal(searchByBody[0].search_text, null);
    assert.equal(searchByBody[0].content_loaded, 0);
    assert.match(searchByBody[0].matched_content, /Heavy/i);

    pages.updatePage({
      id: child.id,
      updates: { content: JSON.stringify([{ type: "paragraph", content: "Indexed replacement body" }]) },
      updatedAt: "2026-01-01T00:00:04.500Z",
    });
    assert.equal(pages.searchPages({ query: "Heavy" }).length, 0);
    assert.equal(pages.searchPages({ query: "replacement" })[0].id, child.id);

    const disposable = pages.createPage({
      id: "disposable",
      title: "Disposable",
      parentId: null,
      createdAt: "2026-01-01T00:00:04.750Z",
    });
    pages.updatePage({
      id: disposable.id,
      updates: { content: "Temporary indexed phrase" },
      updatedAt: "2026-01-01T00:00:04.800Z",
    });
    assert.equal(pages.searchPages({ query: "Temporary" })[0].id, disposable.id);
    pages.deletePage({ id: disposable.id });
    assert.equal(pages.searchPages({ query: "Temporary" }).length, 0);

    assert.throws(
      () =>
        pages.updatePage({
          id: child.id,
          updates: { cover_url: "https://tracker.example/pixel.png" },
          updatedAt: "2026-01-01T00:00:05.000Z",
        }),
      /remote cover images are not allowed/,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("page backend trashes and restores trees, retains versions, and purges after 30 days", () => {
  const { createPageBackend } = require("./backend-pages.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-trash-history-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const pages = createPageBackend({
    appConfigDir: dataDir,
    db,
    withTransaction: (work) => withTransaction(db, work),
  });

  try {
    const root = pages.createPage({
      id: "trash-root",
      title: "Trash root",
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const child = pages.createPage({
      id: "trash-child",
      title: "Trash child",
      parentId: root.id,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    pages.updatePage({
      id: child.id,
      updates: { content: "Find me after restore" },
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    assert.equal(pages.searchPages({ query: "restore" })[0].id, child.id);

    pages.deletePage({
      id: root.id,
      deletedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(pages.listPages().some((page) => page.id === root.id), false);
    assert.equal(pages.searchPages({ query: "restore" }).length, 0);
    assert.equal(pages.getPage({ id: root.id }).is_deleted, 1);
    assert.deepEqual(
      pages.listTrashPages({ now: "2026-01-02T00:00:00.000Z" }).map((page) => ({ id: page.id, count: page.trashed_descendant_count })),
      [{ id: root.id, count: 2 }],
    );

    pages.restorePage({ id: child.id, restoredAt: "2026-01-03T00:00:00.000Z" });
    assert.equal(pages.getPage({ id: root.id }).is_deleted, 0);
    assert.equal(pages.getPage({ id: child.id }).parent_id, root.id);
    assert.equal(pages.searchPages({ query: "restore" })[0].id, child.id);

    const project = pages.createProject({
      id: "restorable-project",
      title: "Restorable project",
      createdAt: "2026-01-03T01:00:00.000Z",
    });
    const projectPage = pages.createPage({
      id: "project-page",
      title: "Project page",
      parentId: project.id,
      createdAt: "2026-01-03T01:00:01.000Z",
    });
    // delete_page accepts project pages too and must follow the recoverable
    // project path rather than bypassing Trash metadata.
    pages.deletePage({ id: project.id, deletedAt: "2026-01-03T01:01:00.000Z" });
    assert.equal(pages.getPage({ id: project.id }).is_deleted, 1);
    assert.equal(pages.getPage({ id: projectPage.id }).parent_id, null);
    pages.restorePage({ id: project.id, restoredAt: "2026-01-03T01:02:00.000Z" });
    assert.equal(pages.getPage({ id: projectPage.id }).parent_id, project.id);

    const history = pages.createPage({
      id: "history",
      title: "History",
      parentId: null,
      createdAt: "2026-01-04T00:00:00.000Z",
    });
    pages.updatePage({
      id: history.id,
      updates: { content: "first draft" },
      updatedAt: "2026-01-04T00:00:01.000Z",
    });
    pages.updatePage({
      id: history.id,
      updates: { content: "second draft" },
      updatedAt: "2026-01-04T00:06:01.000Z",
    });
    const version = pages
      .listPageVersions({ pageId: history.id })
      .find((candidate) => candidate.snapshot.content === "first draft");
    assert.ok(version, "stores a checkpoint before the second important edit");
    pages.restorePageVersion({ id: version.id, restoredAt: "2026-01-04T00:07:00.000Z" });
    assert.equal(pages.getPage({ id: history.id }).content, "first draft");

    const parent = pages.createPage({
      id: "cycle-parent",
      title: "Parent",
      parentId: null,
      createdAt: "2026-01-05T00:00:00.000Z",
    });
    const nested = pages.createPage({
      id: "cycle-child",
      title: "Child",
      parentId: parent.id,
      createdAt: "2026-01-05T00:00:01.000Z",
    });
    pages.movePage({ id: nested.id, parentId: null, updatedAt: "2026-01-05T00:01:00.000Z" });
    pages.movePage({ id: parent.id, parentId: nested.id, updatedAt: "2026-01-05T00:02:00.000Z" });
    const cycleVersion = pages
      .listPageVersions({ pageId: nested.id })
      .find((candidate) => candidate.snapshot.parent_id === parent.id);
    assert.ok(cycleVersion, "keeps the original parent relationship in history");
    pages.restorePageVersion({ id: cycleVersion.id, restoredAt: "2026-01-05T00:03:00.000Z" });
    assert.equal(pages.getPage({ id: nested.id }).parent_id, null, "does not restore a cyclic parent");

    const expired = pages.createPage({
      id: "expired",
      title: "Expired",
      parentId: null,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    pages.deletePage({ id: expired.id, deletedAt: "2020-01-01T00:00:00.000Z" });
    assert.equal(
      pages.purgeExpiredTrash({ now: "2020-01-31T00:00:00.000Z" }),
      1,
    );
    assert.equal(pages.getPage({ id: expired.id }), null);

    assert.throws(
      () => pages.updatePage({ id: history.id, updates: { is_deleted: 1 } }),
      /use delete_page/,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("page import accepts minimal records whose optional fields are omitted", () => {
  const { createPageBackend } = require("./backend-pages.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-pages-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const pages = createPageBackend({
    appConfigDir: dataDir,
    db,
    withTransaction: (work) => withTransaction(db, work),
  });

  try {
    // validateImportedPage allows title/content/timestamps to be omitted, so
    // the insert must not bind `undefined` (node:sqlite rejects it).
    const count = pages.importPageRecords([
      { id: "minimal" },
      {
        id: "with-created",
        title: "Has created",
        created_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    assert.equal(count, 2);

    const minimal = pages.getPage({ id: "minimal" });
    assert.equal(minimal.title, "");
    assert.equal(minimal.content, null);
    assert.equal(minimal.page_kind, "note");
    assert.ok(minimal.created_at, "fills created_at");
    assert.ok(minimal.updated_at, "fills updated_at");

    const withCreated = pages.getPage({ id: "with-created" });
    assert.equal(withCreated.created_at, "2026-02-01T00:00:00.000Z");
    assert.equal(withCreated.updated_at, "2026-02-01T00:00:00.000Z");

    const untitled = pages.createPage({
      id: "untitled",
      parentId: null,
      createdAt: "2026-02-02T00:00:00.000Z",
    });
    assert.equal(untitled.title, "");
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("page backend never stores parent cycles and tree queries survive legacy cycles", () => {
  const { createPageBackend } = require("./backend-pages.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-pages-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const pages = createPageBackend({
    appConfigDir: dataDir,
    db,
    withTransaction: (work) => withTransaction(db, work),
  });

  try {
    pages.importPageRecords([
      { id: "self", title: "Self", parent_id: "self" },
      { id: "loop-a", title: "A", parent_id: "loop-b" },
      { id: "loop-b", title: "B", parent_id: "loop-a" },
      { id: "tail", title: "Tail", parent_id: "loop-a" },
    ]);
    assert.equal(pages.getPage({ id: "self" }).parent_id, null);
    const a = pages.getPage({ id: "loop-a" });
    const b = pages.getPage({ id: "loop-b" });
    assert.ok(
      a.parent_id === null || b.parent_id === null,
      "a two-page cycle is broken on import",
    );
    assert.equal(pages.getPage({ id: "tail" }).parent_id, "loop-a");

    const root = pages.createPage({ id: "root", title: "Root", parentId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    const child = pages.createPage({ id: "child", title: "Child", parentId: root.id, createdAt: "2026-01-01T00:00:01.000Z" });
    assert.throws(
      () => pages.updatePage({ id: root.id, updates: { parent_id: root.id } }),
      /under itself/,
    );
    assert.throws(
      () => pages.updatePage({ id: root.id, updates: { parent_id: child.id } }),
      /descendants/,
    );
    assert.throws(
      () => pages.updatePage({ id: root.id, updates: { parent_id: "missing" } }),
      /does not exist/,
    );
    pages.updatePage({ id: child.id, updates: { parent_id: null } });
    assert.equal(pages.getPage({ id: child.id }).parent_id, null);

    // Databases written before cycle checks existed may still contain loops;
    // recursive tree queries must terminate instead of hanging the app.
    db.prepare("UPDATE pages SET parent_id = 'root' WHERE id = 'child'").run();
    db.prepare("UPDATE pages SET parent_id = 'child' WHERE id = 'root'").run();
    pages.deletePage({ id: root.id, deletedAt: "2026-01-02T00:00:00.000Z" });
    assert.equal(pages.getPage({ id: root.id }).is_deleted, 1);
    assert.equal(pages.getPage({ id: child.id }).is_deleted, 1);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
