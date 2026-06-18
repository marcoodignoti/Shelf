import { describe, expect, it } from "vitest";
import type { Page } from "./db";
import type { StudioDocumentPageLink } from "./studio";
import {
  buildVisibleStudioLinkedPageLinks,
  filterExistingStudioPageCandidates,
  preferredStudioLinkedPageId,
  selectActiveStudioLinkedPage,
} from "./studioWorkspaceLinks";

function page(id: string, title: string, isDeleted = 0): Page {
  return {
    id,
    title,
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: isDeleted,
    is_favorite: 0,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function link(documentId: string, linkedPage: Page, sortOrder = 0): StudioDocumentPageLink {
  return {
    id: `${documentId}-${linkedPage.id}`,
    document_id: documentId,
    page_id: linkedPage.id,
    pdf_page: null,
    label: null,
    sort_order: sortOrder,
    created_at: linkedPage.created_at,
    updated_at: linkedPage.updated_at,
    page: linkedPage,
  };
}

describe("studio workspace linked page helpers", () => {
  it("builds a fallback primary-note link when stored links are not loaded yet", () => {
    const note = page("note", "Primary");

    expect(buildVisibleStudioLinkedPageLinks("doc", [], note, "Primary note")).toEqual([
      {
        id: "fallback-doc",
        document_id: "doc",
        page_id: "note",
        pdf_page: null,
        label: "Primary note",
        sort_order: 0,
        created_at: note.created_at,
        updated_at: note.updated_at,
        page: note,
      },
    ]);
    expect(buildVisibleStudioLinkedPageLinks("doc", [link("doc", note)], note, "Primary note")).toHaveLength(1);
  });

  it("selects the active page from live pages before link snapshots or note fallback", () => {
    const primary = page("primary", "Primary");
    const linked = page("linked", "Linked fresh");
    const staleLinked = page("linked", "Linked stale");

    expect(
      selectActiveStudioLinkedPage({
        selectedId: "linked",
        primaryPageId: primary.id,
        pages: [linked],
        links: [link("doc", staleLinked)],
        note: primary,
      })?.title,
    ).toBe("Linked fresh");

    expect(
      selectActiveStudioLinkedPage({
        selectedId: "primary",
        primaryPageId: primary.id,
        pages: [],
        links: [],
        note: primary,
      })?.id,
    ).toBe("primary");
  });

  it("prefers a selected linked note, then first non-primary link, then primary", () => {
    const primary = page("primary", "Primary");
    const linked = page("linked", "Linked");
    const links = [link("doc", primary, 0), link("doc", linked, 1)];

    expect(preferredStudioLinkedPageId(links, primary.id, "linked")).toBe("linked");
    expect(preferredStudioLinkedPageId(links, primary.id, primary.id)).toBe("linked");
    expect(preferredStudioLinkedPageId([link("doc", primary)], primary.id, null)).toBe("primary");
  });

  it("filters existing page candidates by deletion, linked ids, query, and limit", () => {
    const pages = [
      page("a", "Alpha"),
      page("b", "Beta"),
      page("c", "Gamma"),
      page("d", "Delta", 1),
    ];

    expect(
      filterExistingStudioPageCandidates({
        pages,
        linkedPageIds: new Set(["b"]),
        query: "a",
        untitledLabel: "Untitled",
        limit: 2,
      }).map((candidate) => candidate.id),
    ).toEqual(["a", "c"]);
  });
});
