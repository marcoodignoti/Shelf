import { describe, expect, it } from "vitest";
import { appendedSiblingId, dropPositionFromOffset, reorderedSiblingIds, reorderedWithMovedPageId } from "./pageOrder";

describe("appendedSiblingId", () => {
  it("puts a new sibling at the end without duplicating it", () => {
    expect(appendedSiblingId(["one", "two"], "three")).toEqual(["one", "two", "three"]);
    expect(appendedSiblingId(["one", "three", "two"], "three")).toEqual(["one", "two", "three"]);
  });
});

describe("reorderedSiblingIds", () => {
  it("moves a dragged page before or after a target within the same sibling list", () => {
    expect(reorderedSiblingIds(["one", "two", "three"], "three", "one", "before")).toEqual([
      "three",
      "one",
      "two",
    ]);
    expect(reorderedSiblingIds(["one", "two", "three"], "one", "three", "after")).toEqual([
      "two",
      "three",
      "one",
    ]);
  });
});

describe("reorderedWithMovedPageId", () => {
  it("inserts a moved page before or after a target even when it was not a sibling yet", () => {
    expect(reorderedWithMovedPageId(["parent", "uncle"], "child", "parent", "after")).toEqual([
      "parent",
      "child",
      "uncle",
    ]);
    expect(reorderedWithMovedPageId(["parent", "uncle"], "child", "parent", "before")).toEqual([
      "child",
      "parent",
      "uncle",
    ]);
  });
});

describe("dropPositionFromOffset", () => {
  it("uses the middle of a row as an inside drop target", () => {
    expect(dropPositionFromOffset(4, 24)).toBe("before");
    expect(dropPositionFromOffset(12, 24)).toBe("inside");
    expect(dropPositionFromOffset(21, 24)).toBe("after");
  });
});
