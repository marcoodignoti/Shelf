import { describe, expect, it } from "vitest";
import {
  allStudioDocuments,
  groupStudioDocumentsByProject,
  normalizePanelLayout,
  ProjectableStudioDocument,
  recentStudioDocuments,
  remainingStudioDocuments,
  studioDocumentMetadata,
  studioProjectDepth,
} from "./studioDocuments";
import { StudioDocument, StudioProject } from "./studio";

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
    project_id: null,
  };
}

function projectDoc(
  id: string,
  title: string,
  project: Partial<ProjectableStudioDocument> = {}
): ProjectableStudioDocument {
  return {
    ...doc(id, "2026-05-29T00:00:00.000Z"),
    title,
    ...project,
  };
}

function project(id: string, name: string, sortOrder: number, parentId: string | null = null): StudioProject {
  return {
    id,
    name,
    parent_id: parentId,
    sort_order: sortOrder,
    created_at: "2026-05-29T00:00:00.000Z",
    updated_at: "2026-05-29T00:00:00.000Z",
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

  it("groups assigned documents by project and leaves unassigned documents in Inbox", () => {
    const projects: StudioProject[] = [
      project("empty", "Empty Project", 0),
      project("math", "Math", 1),
      project("physics", "Physics", 2),
    ];
    const groups = groupStudioDocumentsByProject([
      projectDoc("physics-2", "Dynamics", { project_id: "physics" }),
      projectDoc("unfiled", "Alpha"),
      projectDoc("math-1", "Calculus", { project_id: "math" }),
      projectDoc("physics-1", "Beta", { project_id: "physics" }),
    ], projects);

    expect(groups.map((group) => ({
      id: group.project.id,
      name: group.project.name,
      titles: group.documents.map((document) => document.title),
    }))).toEqual([
      { id: "empty", name: "Empty Project", titles: [] },
      { id: "math", name: "Math", titles: ["Calculus"] },
      { id: "physics", name: "Physics", titles: ["Beta", "Dynamics"] },
      { id: "studio-inbox", name: "Inbox", titles: ["Alpha"] },
    ]);
  });

  it("computes project nesting depth for future Studio folders", () => {
    const projects: StudioProject[] = [
      project("root", "Root", 0),
      project("child", "Child", 1, "root"),
      project("grandchild", "Grandchild", 2, "child"),
    ];

    expect(studioProjectDepth(projects[0], projects)).toBe(0);
    expect(studioProjectDepth(projects[1], projects)).toBe(1);
    expect(studioProjectDepth(projects[2], projects)).toBe(2);
    expect(studioProjectDepth(project("orphan", "Orphan", 3, "missing"), projects)).toBe(0);
  });

  it("normalizes panel layout", () => {
    expect(normalizePanelLayout("note-left")).toBe("note-left");
    expect(normalizePanelLayout("bad")).toBe("pdf-left");
  });
});
