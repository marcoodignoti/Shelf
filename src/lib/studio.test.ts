import { describe, expect, it } from "vitest";
import { buildStudioPdfHash, clampStudioPage, clampStudioZoom } from "./studio";

describe("studio viewer helpers", () => {
  it("clamps viewer zoom to supported bounds", () => {
    expect(clampStudioZoom(10)).toBe(25);
    expect(clampStudioZoom(125)).toBe(125);
    expect(clampStudioZoom(500)).toBe(300);
  });

  it("clamps viewer page to positive whole numbers", () => {
    expect(clampStudioPage(-4)).toBe(1);
    expect(clampStudioPage(2.7)).toBe(3);
    expect(clampStudioPage(Number.NaN)).toBe(1);
  });

  it("builds a PDF hash with persisted page and zoom", () => {
    expect(buildStudioPdfHash({ page: 3, zoom: 150 })).toBe("#page=3&zoom=150");
  });
});
