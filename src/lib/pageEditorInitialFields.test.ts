import { describe, expect, it } from "vitest";
import { initialEditorFields } from "./pageEditorInitialFields";

const page = { title: "Saved title", icon: "📌", cover_url: "saved.png", content: "[1]" };

describe("initialEditorFields", () => {
  it("uses the saved page when there are no pending edits", () => {
    expect(initialEditorFields(page, null)).toEqual({
      title: "Saved title",
      icon: "📌",
      coverUrl: "saved.png",
      content: null,
    });
  });

  it("normalizes missing icon and cover to empty strings", () => {
    const fields = initialEditorFields({ ...page, icon: null, cover_url: null }, null);
    expect(fields.icon).toBe("");
    expect(fields.coverUrl).toBe("");
  });

  it("prefers a pending title and keeps other fields from the page", () => {
    expect(initialEditorFields(page, { title: "Draft" })).toEqual({
      title: "Draft",
      icon: "📌",
      coverUrl: "saved.png",
      content: null,
    });
  });

  it("clears the icon when the pending edit removed it", () => {
    expect(initialEditorFields(page, { icon: null }).icon).toBe("");
  });

  it("prefers a pending cover url", () => {
    expect(initialEditorFields(page, { cover_url: "x.png" }).coverUrl).toBe("x.png");
  });

  it("ignores a malformed pending title", () => {
    expect(initialEditorFields(page, { title: 42 as never }).title).toBe("Saved title");
  });

  it("returns pending content when present", () => {
    expect(initialEditorFields(page, { content: "[]" }).content).toBe("[]");
  });
});
