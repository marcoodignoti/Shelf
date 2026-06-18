import { describe, expect, it } from "vitest";
import type { Page } from "./db";
import {
  databaseParentPageForEditor,
  movableEditorPageTargets,
  templatePagesForEditor,
} from "./editorPageCollections";

function page(
  id: string,
  title: string,
  overrides: Partial<Page> = {},
): Page {
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
    ...overrides,
  };
}

describe("editor page collections", () => {
  it("finds database parent pages only when the direct parent is a database", () => {
    const database = page("database", "Database", { is_database: 1 });
    const folder = page("folder", "Folder");
    const row = page("row", "Row", { parent_id: database.id });

    expect(databaseParentPageForEditor([database, folder, row], row)?.id).toBe("database");
    expect(databaseParentPageForEditor([database, folder, row], { ...row, parent_id: folder.id })).toBeNull();
  });

  it("returns template pages in current page order", () => {
    const first = page("first", "First", { is_template: 1 });
    const second = page("second", "Second", { is_template: 1 });

    expect(templatePagesForEditor([page("plain", "Plain"), first, second]).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("filters movable targets by query after excluding the page subtree", () => {
    const root = page("root", "Root");
    const child = page("child", "Child", { parent_id: root.id });
    const target = page("target", "Target Space");
    const other = page("other", "Other");

    expect(
      movableEditorPageTargets([root, child, target, other], root.id, "space").map((item) => item.id),
    ).toEqual(["target"]);
    expect(
      movableEditorPageTargets([root, child, target, other], child.id, "").map((item) => item.id),
    ).toEqual(["root", "target", "other"]);
  });
});
