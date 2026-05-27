import { describe, expect, it } from "vitest";
import { HOME_PAGE_ID, resolveCurrentPageId } from "./navigation";
import { Page } from "./db";

const page = (id: string, updatedAt: string): Page => ({
  id,
  title: id,
  parent_id: null,
  content: null,
  search_text: null,
  icon: null,
  cover_url: null,
  is_deleted: 0,
  is_favorite: 0,
  is_template: 0,
  sort_order: 0,
  page_kind: "note",
  created_at: updatedAt,
  updated_at: updatedAt,
});

describe("resolveCurrentPageId", () => {
  it("keeps Home selected when Home is current", () => {
    expect(resolveCurrentPageId([page("a", "2026-05-18T00:00:00.000Z")], HOME_PAGE_ID)).toBe(HOME_PAGE_ID);
  });

  it("keeps existing selected page", () => {
    expect(resolveCurrentPageId([page("a", "2026-05-18T00:00:00.000Z")], "a")).toBe("a");
  });

  it("falls back to first page when selected page is gone", () => {
    expect(resolveCurrentPageId([page("a", "2026-05-18T00:00:00.000Z")], "missing")).toBe("a");
  });

  it("shows Home when workspace has no pages", () => {
    expect(resolveCurrentPageId([], "missing")).toBe(HOME_PAGE_ID);
  });
});
