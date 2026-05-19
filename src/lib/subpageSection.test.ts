import { describe, expect, it } from "vitest";
import { subpageSectionMode } from "./subpageSection";

describe("subpageSectionMode", () => {
  it("uses visible list mode when children exist", () => {
    expect(subpageSectionMode(2)).toBe("list");
  });

  it("uses hover create mode when no children exist", () => {
    expect(subpageSectionMode(0)).toBe("hover-create");
  });
});
