import { describe, expect, it } from "vitest";
import { computeFloatingPosition } from "./floatingPosition";

describe("computeFloatingPosition", () => {
  it("places a popover below the anchor when it fits", () => {
    expect(
      computeFloatingPosition(
        { left: 40, right: 140, top: 30, bottom: 60, width: 100, height: 30 },
        { width: 160, height: 120 },
        { width: 500, height: 400 }
      )
    ).toEqual({ left: 40, top: 66, maxWidth: 448, maxHeight: 322 });
  });

  it("keeps a popover inside the right and bottom viewport edges", () => {
    expect(
      computeFloatingPosition(
        { left: 420, right: 480, top: 300, bottom: 330, width: 60, height: 30 },
        { width: 160, height: 120 },
        { width: 500, height: 400 }
      )
    ).toEqual({ left: 328, top: 174, maxWidth: 160, maxHeight: 214 });
  });

  it("keeps a popover inside the left and top viewport edges", () => {
    expect(
      computeFloatingPosition(
        { left: 4, right: 80, top: 4, bottom: 34, width: 76, height: 30 },
        { width: 160, height: 120 },
        { width: 500, height: 400 }
      )
    ).toEqual({ left: 12, top: 40, maxWidth: 476, maxHeight: 348 });
  });

  it("limits maximum height from the final clamped position", () => {
    expect(
      computeFloatingPosition(
        { left: 250, right: 290, top: 150, bottom: 180, width: 40, height: 30 },
        { width: 180, height: 500 },
        { width: 320, height: 260 }
      )
    ).toEqual({ left: 128, top: 12, maxWidth: 180, maxHeight: 236 });
  });
});
