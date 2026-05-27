import { describe, expect, it } from "vitest";
import { Page } from "./db";
import { childPagesForParent, moveTargetPages, visiblePageIds } from "./pageTree";

function page(id: string, parent_id: string | null = null): Page {
  return {
    id,
    title: id,
    parent_id,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-18T00:00:00.000Z",
  };
}

describe("moveTargetPages", () => {
  it("excludes the moved page and its descendants", () => {
    const pages = [
      page("parent"),
      page("child", "parent"),
      page("grandchild", "child"),
      page("sibling"),
    ];

    expect(moveTargetPages(pages, "parent").map((target) => target.id)).toEqual(["sibling"]);
    expect(moveTargetPages(pages, "child").map((target) => target.id)).toEqual(["parent", "sibling"]);
  });
});

describe("visiblePageIds", () => {
  it("flattens expanded pages in sidebar order", () => {
    const pages = [
      { ...page("parent"), sort_order: 0 },
      { ...page("sibling"), sort_order: 1 },
      { ...page("child", "parent"), sort_order: 0 },
      { ...page("grandchild", "child"), sort_order: 0 },
    ];

    expect(visiblePageIds(pages, new Set(["parent"]))).toEqual(["parent", "child", "sibling"]);
    expect(visiblePageIds(pages, new Set(["parent", "child"]))).toEqual([
      "parent",
      "child",
      "grandchild",
      "sibling",
    ]);
  });
});

describe("childPagesForParent", () => {
  it("returns direct children in sidebar order only", () => {
    const pages = [
      { ...page("second", "parent"), sort_order: 1 },
      { ...page("nested", "first"), sort_order: 0 },
      { ...page("first", "parent"), sort_order: 0 },
      { ...page("other") },
    ];

    expect(childPagesForParent(pages, "parent").map((child) => child.id)).toEqual(["first", "second"]);
  });

  it("returns empty list when parent has no children", () => {
    expect(childPagesForParent([page("parent"), page("other")], "parent")).toEqual([]);
  });
});
