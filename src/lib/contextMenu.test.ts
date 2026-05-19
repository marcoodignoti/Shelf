import { describe, expect, it } from "vitest";
import { clampContextMenuPosition } from "./contextMenu";

describe("clampContextMenuPosition", () => {
  it("keeps menu at pointer when it fits", () => {
    expect(clampContextMenuPosition(40, 50, 300, 300, 120, 160)).toEqual({ left: 40, top: 50 });
  });

  it("keeps menu inside viewport", () => {
    expect(clampContextMenuPosition(260, 250, 300, 300, 120, 160)).toEqual({ left: 168, top: 128 });
  });

  it("keeps menu away from the viewport edge", () => {
    expect(clampContextMenuPosition(4, 5, 300, 300, 120, 160)).toEqual({ left: 12, top: 12 });
  });
});
