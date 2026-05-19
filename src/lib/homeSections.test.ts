import { describe, expect, it } from "vitest";
import { favoritePages, recentPages } from "./homeSections";
import { Page } from "./db";

function page(id: string, updatedAt: string, isFavorite = 0): Page {
  return {
    id,
    title: id,
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: isFavorite,
    is_template: 0,
    sort_order: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe("recentPages", () => {
  it("returns most recently updated pages first", () => {
    const pages = [
      page("old", "2026-05-18T08:00:00.000Z"),
      page("new", "2026-05-18T10:00:00.000Z"),
      page("middle", "2026-05-18T09:00:00.000Z"),
    ];

    expect(recentPages(pages).map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });
});

describe("favoritePages", () => {
  it("returns only favorite pages", () => {
    expect(
      favoritePages([
        page("regular", "2026-05-18T08:00:00.000Z"),
        page("favorite", "2026-05-18T09:00:00.000Z", 1),
      ]).map((item) => item.id)
    ).toEqual(["favorite"]);
  });
});
