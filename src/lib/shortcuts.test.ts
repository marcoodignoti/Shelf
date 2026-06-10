import { describe, expect, it } from "vitest";
import { isNewPageShortcut } from "./shortcuts";
import { SHORTCUT_GROUPS } from "./shortcuts";

describe("isNewPageShortcut", () => {
  it("matches Cmd/Ctrl+N without shift", () => {
    expect(isNewPageShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true);
    expect(isNewPageShortcut({ key: "N", metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true);
    expect(isNewPageShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: true })).toBe(false);
  });
});

describe("SHORTCUT_GROUPS", () => {
  it("has at least one group with at least one shortcut each", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const group of SHORTCUT_GROUPS) {
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("uses translation keys for every label", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.titleKey.startsWith("shortcuts.")).toBe(true);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.labelKey.startsWith("shortcuts.")).toBe(true);
        expect(shortcut.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate key combos within a group", () => {
    for (const group of SHORTCUT_GROUPS) {
      const combos = group.shortcuts.map((s) => s.keys.join("+"));
      expect(new Set(combos).size).toBe(combos.length);
    }
  });
});
