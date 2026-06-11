import { describe, expect, it } from "vitest";
import { commandPaletteSections } from "./commandPaletteSections";
import { Page, SearchResult } from "./db";

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
    page_kind: "note",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe("commandPaletteSections", () => {
  it("shows favorites and recent pages when query is empty", () => {
    const sections = commandPaletteSections({
      query: "",
      pages: [
        page("old", "2026-05-18T08:00:00.000Z"),
        page("favorite", "2026-05-18T09:00:00.000Z", 1),
      ],
      searchResults: [],
    });

    expect(sections.map((section) => section.titleKey)).toEqual(["commandPalette.favorites", "commandPalette.recent"]);
    expect(sections.flatMap((section) => section.pages.map((item) => item.id))).toEqual(["favorite", "favorite", "old"]);
  });

  it("shows search results only when query has text", () => {
    const result: SearchResult = { ...page("match", "2026-05-18T08:00:00.000Z"), matched_content: "Matched content" };

    expect(
      commandPaletteSections({
        query: "match",
        pages: [page("other", "2026-05-18T09:00:00.000Z", 1)],
        searchResults: [result],
      })
    ).toEqual([{ titleKey: "commandPalette.searchResults", pages: [result] }]);
  });
});
