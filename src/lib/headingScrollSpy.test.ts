import { describe, expect, it } from "vitest";
import { activeHeadingFromOffsets } from "./headingScrollSpy";

describe("activeHeadingFromOffsets", () => {
  it("returns null without headings", () => {
    expect(activeHeadingFromOffsets([], 0)).toBeNull();
  });

  it("falls back to the first heading when none has scrolled past", () => {
    expect(activeHeadingFromOffsets([{ id: "a", top: 400 }, { id: "b", top: 900 }], 0)).toBe("a");
  });

  it("picks the last heading above the threshold line", () => {
    const headings = [{ id: "a", top: 0 }, { id: "b", top: 100 }, { id: "c", top: 500 }];
    expect(activeHeadingFromOffsets(headings, 0)).toBe("b");
  });

  it("skips headings that are not mounted", () => {
    expect(activeHeadingFromOffsets([{ id: "a", top: null }, { id: "b", top: 50 }], 0)).toBe("b");
  });

  it("counts a heading exactly on the threshold line as passed", () => {
    expect(activeHeadingFromOffsets([{ id: "a", top: 0 }, { id: "b", top: 240 }], 100)).toBe("b");
  });
});
