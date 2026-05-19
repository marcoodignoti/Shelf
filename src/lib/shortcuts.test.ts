import { describe, expect, it } from "vitest";
import { isNewPageShortcut } from "./shortcuts";

describe("isNewPageShortcut", () => {
  it("matches Cmd/Ctrl+N without shift", () => {
    expect(isNewPageShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true);
    expect(isNewPageShortcut({ key: "N", metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true);
    expect(isNewPageShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: true })).toBe(false);
  });
});
