import { describe, expect, it } from "vitest";
import type { Page } from "./db";
import type { StudioDocument, StudioDocumentPageLink } from "./studio";
import { buildPageStudioContexts } from "./studioPageContexts";

function page(id: string, pageKind: Page["page_kind"] = "note"): Page {
  return {
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
    page_kind: pageKind,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  };
}

function document(id: string, title: string): StudioDocument {
  return {
    id,
    title,
    original_filename: `${title}.pdf`,
    stored_file_path: `/tmp/${id}.pdf`,
    note_page_id: `${id}-note`,
    project_id: null,
    last_opened_at: "2026-06-12T00:00:00.000Z",
    viewer_zoom: 100,
    viewer_page: 1,
    panel_layout: "pdf-left",
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
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
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    page: linkedPage,
  };
}

describe("buildPageStudioContexts", () => {
  it("indexes normal note pages linked to Studio documents", () => {
    const normalNote = page("normal-note", "note");
    const contexts = buildPageStudioContexts(
      [document("doc", "Civil Law")],
      [link("doc", normalNote)]
    );

    expect(contexts.get("normal-note")?.map((context) => context.document.title)).toEqual(["Civil Law"]);
  });

  it("keeps studio notes and normal notes in the same context index", () => {
    const normalNote = page("normal-note", "note");
    const studioNote = page("studio-note", "studio_note");
    const contexts = buildPageStudioContexts(
      [document("doc", "Civil Law")],
      [link("doc", normalNote), link("doc", studioNote)]
    );

    expect(contexts.get("normal-note")).toHaveLength(1);
    expect(contexts.get("studio-note")).toHaveLength(1);
  });

  it("sorts multiple document contexts by document title then link order", () => {
    const normalNote = page("normal-note", "note");
    const contexts = buildPageStudioContexts(
      [document("b", "Beta"), document("a", "Alpha"), document("a2", "Alpha")],
      [link("b", normalNote, 0), link("a2", normalNote, 2), link("a", normalNote, 1)]
    );

    expect(contexts.get("normal-note")?.map((context) => `${context.document.id}:${context.link.sort_order}`)).toEqual([
      "a:1",
      "a2:2",
      "b:0",
    ]);
  });

  it("ignores links whose Studio document no longer exists", () => {
    const normalNote = page("normal-note", "note");
    const contexts = buildPageStudioContexts([], [link("missing", normalNote)]);

    expect(contexts.has("normal-note")).toBe(false);
  });
});
