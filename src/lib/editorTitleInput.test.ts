import { describe, expect, it } from "vitest";
import { titleBeforeInputAction, titleEnterShouldInsertNewline } from "./editorTitleInput";

describe("editor title input", () => {
  it("sends plain Enter to the body when title behavior is body", () => {
    expect(titleEnterShouldInsertNewline("body", { altKey: false, shiftKey: false })).toBe(false);
  });

  it("uses Alt or Shift Enter for newlines when title behavior is body", () => {
    expect(titleEnterShouldInsertNewline("body", { altKey: true, shiftKey: false })).toBe(true);
    expect(titleEnterShouldInsertNewline("body", { altKey: false, shiftKey: true })).toBe(true);
  });

  it("uses plain Enter for newlines when title behavior is newline", () => {
    expect(titleEnterShouldInsertNewline("newline", { altKey: false, shiftKey: false })).toBe(true);
  });

  it("uses Alt Enter to send focus to the body when title behavior is newline", () => {
    expect(titleEnterShouldInsertNewline("newline", { altKey: true, shiftKey: false })).toBe(false);
  });
});

describe("titleBeforeInputAction", () => {
  it("ignores input that is not a line break", () => {
    expect(titleBeforeInputAction("insertText", false)).toBe("ignore");
  });

  it("sends a line break to the body when no newline modifier was held", () => {
    expect(titleBeforeInputAction("insertLineBreak", false)).toBe("focus-body");
  });

  it("keeps the line break in the title when a newline modifier was held", () => {
    expect(titleBeforeInputAction("insertLineBreak", true)).toBe("insert-newline");
  });
});
