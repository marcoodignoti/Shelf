import { describe, expect, it } from "vitest";
import type { Page } from "./types";
import { pageBreadcrumb } from "./breadcrumb";

function page(id: string, title: string, parentId: string | null = null): Page {
  return {
    id,
    title,
    parent_id: parentId,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-05-18T08:00:00.000Z",
    updated_at: "2026-05-18T08:00:00.000Z",
  };
}

describe("pageBreadcrumb", () => {
  it("returns ancestors and current page from root to leaf", () => {
    const pages = [
      page("root", "Root"),
      page("child", "Child", "root"),
      page("leaf", "Leaf", "child"),
    ];

    expect(pageBreadcrumb(pages, "leaf").map((item) => item.title)).toEqual(["Root", "Child", "Leaf"]);
  });

  it("stops if parent is missing", () => {
    expect(pageBreadcrumb([page("leaf", "Leaf", "missing")], "leaf").map((item) => item.title)).toEqual(["Leaf"]);
  });
});
