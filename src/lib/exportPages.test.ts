import { describe, expect, it } from "vitest";
import type { Page } from "./db";
import {
  buildMarkdownTreeFiles,
  buildPageTreeExport,
  collectDescendantPageIds,
  mergePagesForExport,
  parsePageTreeExport,
  sanitizeExportFilename,
} from "./exportPages";

function makePage(id: string, title: string, parentId: string | null = null): Page {
  return {
    id,
    title,
    parent_id: parentId,
    content: JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: `${title} body` }] }]),
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as Page;
}

const renderTitle = async (page: Page) => `${page.title} markdown`;

describe("sanitizeExportFilename", () => {
  it("replaces path and shell-hostile characters", () => {
    expect(sanitizeExportFilename("a/b\\c:d|e<f>g?h%i*j.k l")).toBe("a_b_c_d_e_f_g_h_i_j_k_l");
  });

  it("falls back to Untitled when nothing survives", () => {
    expect(sanitizeExportFilename("")).toBe("Untitled");
    expect(sanitizeExportFilename("...")).toBe("___");
  });
});

describe("collectDescendantPageIds", () => {
  it("collects roots and nested descendants only", () => {
    const pages = [
      makePage("a", "A"),
      makePage("b", "B", "a"),
      makePage("c", "C", "b"),
      makePage("d", "D"),
    ];
    expect(collectDescendantPageIds(pages, ["a"])).toEqual(new Set(["a", "b", "c"]));
  });

  it("supports multiple roots", () => {
    const pages = [makePage("a", "A"), makePage("b", "B"), makePage("c", "C", "b")];
    expect(collectDescendantPageIds(pages, ["a", "b"])).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("buildPageTreeExport", () => {
  it("exports the subtree with metadata", () => {
    const pages = [makePage("a", "A"), makePage("b", "B", "a"), makePage("x", "X")];
    const data = buildPageTreeExport(pages, ["a"], "2026-06-10T00:00:00.000Z");
    expect(data.version).toBe(1);
    expect(data.type).toBe("page_tree");
    expect(data.root_page_id).toBe("a");
    expect(data.exported_at).toBe("2026-06-10T00:00:00.000Z");
    expect(data.pages.map((page) => page.id)).toEqual(["a", "b"]);
  });
});

describe("mergePagesForExport", () => {
  it("uses hydrated backend content for unloaded pages", () => {
    const hydratedPages = [
      makePage("a", "A"),
      makePage("b", "B", "a"),
    ];
    const currentPages = [
      {
        ...makePage("a", "A"),
        content: null,
        search_text: null,
        content_loaded: 0,
      },
      {
        ...makePage("b", "B", "a"),
        content: JSON.stringify([{ type: "paragraph", content: "local edit" }]),
        search_text: "local edit",
        content_loaded: 1,
      },
    ];

    expect(mergePagesForExport(hydratedPages, currentPages)).toEqual([
      hydratedPages[0],
      {
        ...hydratedPages[1],
        content: currentPages[1].content,
        search_text: currentPages[1].search_text,
        content_loaded: 1,
      },
    ]);
  });
});

describe("parsePageTreeExport", () => {
  it("accepts page tree export JSON", () => {
    const data = buildPageTreeExport([makePage("a", "A")], ["a"], "2026-06-10T00:00:00.000Z");

    expect(parsePageTreeExport(JSON.stringify(data))).toEqual(data);
  });

  it("rejects malformed page tree exports", () => {
    expect(() => parsePageTreeExport("{bad")).toThrow("Invalid JSON file");
    expect(() => parsePageTreeExport(JSON.stringify({ version: 1, pages: [] }))).toThrow("Unsupported JSON export format");
    expect(() =>
      parsePageTreeExport(JSON.stringify({ ...buildPageTreeExport([makePage("a", "A")], ["a"], "now"), pages: [{ id: "a" }] }))
    ).toThrow("Unsupported JSON export format");
  });
});

describe("buildMarkdownTreeFiles", () => {
  it("exports a leaf page as a single file", async () => {
    const pages = [makePage("a", "Solo")];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle);
    expect(files).toEqual([
      { relativePath: "Solo.md", content: "# Solo\n\nSolo markdown" },
    ]);
  });

  it("creates a directory per page with children", async () => {
    const pages = [
      makePage("a", "Root"),
      makePage("b", "Child", "a"),
      makePage("c", "Grandchild", "b"),
    ];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle);
    expect(files.map((file) => file.relativePath)).toEqual([
      "Root/Root.md",
      "Root/Child/Child.md",
      "Root/Child/Grandchild.md",
    ]);
  });

  it("deduplicates sibling names instead of overwriting", async () => {
    const pages = [
      makePage("a", "Root"),
      makePage("b", "Note", "a"),
      makePage("c", "Note", "a"),
      makePage("d", "note", "a"),
    ];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle);
    expect(files.map((file) => file.relativePath)).toEqual([
      "Root/Root.md",
      "Root/Note.md",
      "Root/Note 2.md",
      "Root/note 3.md",
    ]);
  });

  it("merges multiple roots into one top level with shared dedup", async () => {
    const pages = [makePage("a", "Notes"), makePage("b", "Notes")];
    const files = await buildMarkdownTreeFiles(pages, pages, renderTitle);
    expect(files.map((file) => file.relativePath)).toEqual(["Notes.md", "Notes 2.md"]);
  });

  it("sanitizes titles with path separators", async () => {
    const pages = [makePage("a", "a/b\\c")];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle);
    expect(files[0].relativePath).toBe("a_b_c.md");
  });

  it("flattens a single root so the export root is not doubled", async () => {
    const pages = [
      makePage("a", "Root"),
      makePage("b", "Child", "a"),
      makePage("c", "Grandchild", "b"),
    ];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle, { flattenSingleRoot: true });
    expect(files.map((file) => file.relativePath)).toEqual([
      "Root.md",
      "Child/Child.md",
      "Child/Grandchild.md",
    ]);
  });

  it("does not flatten a single leaf root", async () => {
    const pages = [makePage("a", "Solo")];
    const files = await buildMarkdownTreeFiles(pages, [pages[0]], renderTitle, { flattenSingleRoot: true });
    expect(files.map((file) => file.relativePath)).toEqual(["Solo.md"]);
  });
});
