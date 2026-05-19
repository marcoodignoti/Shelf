import { describe, expect, it } from "vitest";
import { blockDropPlacementFromOffset } from "./blockDrag";

describe("blockDropPlacementFromOffset", () => {
  it("drops before when pointer is in upper half", () => {
    expect(blockDropPlacementFromOffset(19, 40)).toBe("before");
  });

  it("drops after when pointer is in lower half", () => {
    expect(blockDropPlacementFromOffset(20, 40)).toBe("after");
  });
});
