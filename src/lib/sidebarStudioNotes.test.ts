import { describe, expect, it } from "vitest";
import type { Page } from "./db";
import type { StudioDocument, StudioDocumentPageLink } from "./studio";
import { buildStudioNoteDocuments } from "./sidebarStudioNotes";

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    title: "Note",
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: "studio_note",
    created_at: "2026-06-17T10:00:00.000Z",
    updated_at: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

function document(overrides: Partial<StudioDocument> = {}): StudioDocument {
  return {
    id: "doc-1",
    title: "Document",
    original_filename: "document.pdf",
    stored_file_path: "/tmp/document.pdf",
    note_page_id: "page-1",
    project_id: null,
    last_opened_at: "2026-06-17T10:00:00.000Z",
    viewer_zoom: 1,
    viewer_page: 1,
    panel_layout: "pdf-left",
    created_at: "2026-06-17T10:00:00.000Z",
    updated_at: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

function link(overrides: Partial<StudioDocumentPageLink> = {}): StudioDocumentPageLink {
  const linkedPage = page({ id: "linked-page", title: "Linked Note" });
  return {
    id: "link-1",
    document_id: "doc-1",
    page_id: linkedPage.id,
    pdf_page: 12,
    label: null,
    sort_order: 0,
    created_at: "2026-06-17T10:00:00.000Z",
    updated_at: "2026-06-17T10:00:00.000Z",
    page: linkedPage,
    ...overrides,
  };
}

describe("buildStudioNoteDocuments", () => {
  it("prepends the primary studio note when a document has linked notes but no primary link", () => {
    const primaryNote = page({ id: "primary-note", title: "Primary" });
    const linkedNote = page({ id: "linked-note", title: "Linked" });
    const doc = document({ note_page_id: primaryNote.id });
    const linked = link({ page_id: linkedNote.id, page: linkedNote });

    const result = buildStudioNoteDocuments([doc], [linked], [primaryNote, linkedNote]);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].noteEntries.map((entry) => entry.page.id)).toEqual([
      primaryNote.id,
      linkedNote.id,
    ]);
    expect(result.documents[0].noteEntries[0].link).toBeNull();
    expect([...result.linkedPageIds].sort()).toEqual([linkedNote.id, primaryNote.id].sort());
  });

  it("ignores non-studio-note links and omits documents without entries", () => {
    const regularNote = page({ id: "regular-note", page_kind: "note" });
    const doc = document({ note_page_id: "missing-primary" });
    const regularLink = link({ page_id: regularNote.id, page: regularNote });

    const result = buildStudioNoteDocuments([doc], [regularLink], []);

    expect(result.documents).toEqual([]);
    expect(result.linkedPageIds.size).toBe(0);
  });
});
