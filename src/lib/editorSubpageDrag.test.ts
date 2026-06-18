import { describe, expect, it } from "vitest";
import {
  orderedSubpageIdsFromDropTarget,
  subpageDropTargetFromRow,
} from "./editorSubpageDrag";

function rowElement(pageId: string, rect: Partial<DOMRect> = {}): HTMLElement {
  return {
    dataset: { subpageRowId: pageId },
    getBoundingClientRect: () => ({
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    top: 100,
    right: 200,
    bottom: 140,
    left: 0,
    toJSON: () => ({}),
    ...rect,
    }),
  } as unknown as HTMLElement;
}

describe("editor subpage drag", () => {
  it("builds a before or after drop target from pointer position within a row", () => {
    const row = rowElement("target");

    expect(subpageDropTargetFromRow(row, "source", 110)).toEqual({
      pageId: "target",
      position: "before",
    });
    expect(subpageDropTargetFromRow(row, "source", 130)).toEqual({
      pageId: "target",
      position: "after",
    });
  });

  it("rejects missing rows, missing ids, and self drops", () => {
    expect(subpageDropTargetFromRow(null, "source", 120)).toBeNull();

    const missingId = { dataset: {} } as unknown as HTMLElement;
    expect(subpageDropTargetFromRow(missingId, "source", 120)).toBeNull();
    expect(subpageDropTargetFromRow(rowElement("source"), "source", 120)).toBeNull();
  });

  it("returns reordered ids only when the drop target changes sibling order", () => {
    expect(
      orderedSubpageIdsFromDropTarget(["a", "b", "c"], "c", {
        pageId: "a",
        position: "before",
      }),
    ).toEqual(["c", "a", "b"]);

    expect(
      orderedSubpageIdsFromDropTarget(["a", "b", "c"], "b", {
        pageId: "b",
        position: "before",
      }),
    ).toBeNull();
  });
});
