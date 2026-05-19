import { describe, expect, it } from "vitest";
import { normalizePageTitle } from "./pageTitle";

describe("normalizePageTitle", () => {
  it("trims whitespace", () => {
    expect(normalizePageTitle("  Roadmap  ")).toBe("Roadmap");
  });

  it("falls back to Untitled when empty", () => {
    expect(normalizePageTitle("   ")).toBe("Untitled");
  });
});
