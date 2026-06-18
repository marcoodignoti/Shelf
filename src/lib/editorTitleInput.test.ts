import { describe, expect, it } from "vitest";
import { titleEnterShouldInsertNewline } from "./editorTitleInput";

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
