import { describe, expect, it } from "vitest";
import {
  buildStudioPanelGridColumns,
  buildStudioPdfHash,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  studioPanelRatioFromPointer,
} from "./studio";

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

  it("clamps invalid PDF hash values before persisting them", () => {
    expect(buildStudioPdfHash({ page: Number.NaN, zoom: 500 })).toBe("#page=1&zoom=300");
  });

  it("clamps Studio panel ratio to usable bounds", () => {
    expect(clampStudioPanelRatio(10)).toBe(30);
    expect(clampStudioPanelRatio(55.4)).toBe(55);
    expect(clampStudioPanelRatio(90)).toBe(70);
  });

  it("builds panel columns based on PDF side", () => {
    expect(buildStudioPanelGridColumns("pdf-left", 60)).toBe("60% 6px 40%");
    expect(buildStudioPanelGridColumns("note-left", 60)).toBe("40% 6px 60%");
  });

  it("calculates PDF ratio from pointer for either panel order", () => {
    expect(studioPanelRatioFromPointer("pdf-left", 700, { left: 100, width: 1000 })).toBe(60);
    expect(studioPanelRatioFromPointer("note-left", 700, { left: 100, width: 1000 })).toBe(40);
  });

  it("falls back to an even split when panel width cannot be measured", () => {
    expect(studioPanelRatioFromPointer("pdf-left", 700, { left: 100, width: 0 })).toBe(50);
  });
});
