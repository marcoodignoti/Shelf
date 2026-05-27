import { describe, expect, it } from "vitest";
import { buildBackup, parseBackup, prepareImportedPages } from "./backup";
import { Page } from "./db";

function page(id: string, parent_id: string | null = null): Page {
  return {
    id,
    title: id,
    parent_id,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-18T00:00:00.000Z",
  };
}

describe("buildBackup", () => {
  it("creates a versioned backup document", () => {
    const backup = buildBackup([page("one")], "2026-05-18T10:00:00.000Z");

    expect(backup).toEqual({
      version: 1,
      exported_at: "2026-05-18T10:00:00.000Z",
      pages: [page("one")],
    });
  });
});

describe("parseBackup", () => {
  it("accepts versioned backup JSON", () => {
    const backup = buildBackup([page("one")], "2026-05-18T10:00:00.000Z");

    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it("rejects malformed backup JSON", () => {
    expect(() => parseBackup("{bad")).toThrow("Backup file is not valid JSON");
    expect(() =>
      parseBackup(JSON.stringify({ version: 1, exported_at: "2026-05-18T10:00:00.000Z", pages: "nope" }))
    ).toThrow("Backup file has invalid pages");
  });

  it("rejects malformed database metadata in backup pages", () => {
    expect(() =>
      parseBackup(JSON.stringify(buildBackup([{ ...page("one"), properties: { status: "Done" } as never }])))
    ).toThrow("Backup file has invalid pages");

    expect(() =>
      parseBackup(JSON.stringify(buildBackup([{ ...page("one"), database_schema: { properties: [] } as never }])))
    ).toThrow("Backup file has invalid pages");
  });
});

describe("prepareImportedPages", () => {
  it("duplicates pages with new IDs and remaps parent IDs", () => {
    const imported = prepareImportedPages(
      [page("parent"), page("child", "parent")],
      () => "2026-05-18T11:00:00.000Z",
      () => "new-id"
    );

    expect(imported).toEqual([
      {
        ...page("parent"),
        id: "new-id-1",
        parent_id: null,
        created_at: "2026-05-18T11:00:00.000Z",
        updated_at: "2026-05-18T11:00:00.000Z",
      },
      {
        ...page("child", "parent"),
        id: "new-id-2",
        parent_id: "new-id-1",
        created_at: "2026-05-18T11:00:00.000Z",
        updated_at: "2026-05-18T11:00:00.000Z",
      },
    ]);
  });
});
