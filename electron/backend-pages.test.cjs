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
