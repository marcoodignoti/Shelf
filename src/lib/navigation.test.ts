import { describe, expect, it } from "vitest";
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from "./navigation";
import { Page } from "./db";

const page = (id: string, updatedAt: string, parentId: string | null = null): Page => ({
  id,
  title: id,
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

describe("resolveCurrentPageIdAfterDeletion", () => {
  const t = "2026-05-18T00:00:00.000Z";

  it("redirects to parent page when deleting the current subpage", () => {
    const parent = page("parent", t);
    const subpage = page("subpage", t, "parent");
    const pagesBefore = [parent, subpage];
    const pagesAfter = [parent];
    const deletedIds = new Set(["subpage"]);
    expect(
      resolveCurrentPageIdAfterDeletion(pagesAfter, "subpage", "subpage", deletedIds, pagesBefore)
    ).toBe("parent");
  });

  it("redirects to parent page when deleting an ancestor of the current subpage", () => {
    const root = page("root", t);
    const subpage = page("subpage", t, "root");
    const leaf = page("leaf", t, "subpage");
    const pagesBefore = [root, subpage, leaf];
    const pagesAfter = [root];
    const deletedIds = new Set(["subpage", "leaf"]);
    expect(
      resolveCurrentPageIdAfterDeletion(pagesAfter, "leaf", "subpage", deletedIds, pagesBefore)
    ).toBe("root");
  });

  it("falls back using resolveCurrentPageId when deleting a top-level page with no parent", () => {
    const deleted = page("deleted", t);
    const remaining = page("remaining", t);
    const pagesBefore = [deleted, remaining];
    const pagesAfter = [remaining];
    const deletedIds = new Set(["deleted"]);
    expect(
      resolveCurrentPageIdAfterDeletion(pagesAfter, "deleted", "deleted", deletedIds, pagesBefore)
    ).toBe("remaining");
  });

  it("keeps the current page if it is not inside the deleted set", () => {
    const deleted = page("deleted", t);
    const active = page("active", t);
    const pagesBefore = [deleted, active];
    const pagesAfter = [active];
    const deletedIds = new Set(["deleted"]);
    expect(
      resolveCurrentPageIdAfterDeletion(pagesAfter, "active", "deleted", deletedIds, pagesBefore)
    ).toBe("active");
  });
});

