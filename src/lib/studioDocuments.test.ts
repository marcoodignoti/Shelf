import { describe, expect, it } from "vitest";
import {
  allStudioDocuments,
  remainingStudioDocuments,
  studioDocumentMetadata,
  normalizePanelLayout,
  recentStudioDocuments,
} from "./studioDocuments";
import { StudioDocument } from "./studio";

function doc(id: string, lastOpenedAt: string): StudioDocument {
  return {
    id,
    title: id,
    original_filename: `${id}.pdf`,
    stored_file_path: `/tmp/${id}.pdf`,
    note_page_id: `${id}-note`,
    last_opened_at: lastOpenedAt,
    viewer_zoom: 100,
    viewer_page: 1,
    panel_layout: "pdf-left",
    created_at: lastOpenedAt,
    updated_at: lastOpenedAt,
  };
}

describe("studio document helpers", () => {
  it("sorts recent documents by last opened date", () => {
    expect(
      recentStudioDocuments([
        doc("old", "2026-05-27T08:00:00.000Z"),
        doc("new", "2026-05-27T10:00:00.000Z"),
        doc("middle", "2026-05-27T09:00:00.000Z"),
      ]).map((item) => item.id)
    ).toEqual(["new", "middle", "old"]);
  });

  it("sorts all documents by title", () => {
    expect(
      allStudioDocuments([
        doc("Bravo", "2026-05-27T08:00:00.000Z"),
        doc("Alpha", "2026-05-27T08:00:00.000Z"),
      ]).map((item) => item.id)
    ).toEqual(["Alpha", "Bravo"]);
  });

  it("excludes recent documents from remaining documents", () => {
    const old = doc("old", "2026-05-27T08:00:00.000Z");
    const newer = doc("newer", "2026-05-27T09:00:00.000Z");
    const newest = doc("newest", "2026-05-27T10:00:00.000Z");

    expect(remainingStudioDocuments([old, newest, newer], [newest, newer]).map((item) => item.id)).toEqual(["old"]);
  });

  it("formats document metadata from filename and last opened date", () => {
    expect(studioDocumentMetadata(doc("Chapter One", "2026-05-27T10:15:00.000Z"))).toBe(
      "Chapter One.pdf · 27 mag 2026"
    );
  });

  it("normalizes panel layout", () => {
    expect(normalizePanelLayout("note-left")).toBe("note-left");
    expect(normalizePanelLayout("bad")).toBe("pdf-left");
  });
});
