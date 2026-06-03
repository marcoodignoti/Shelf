import { describe, expect, it } from "vitest";
import {
  buildStudioPanelGridColumns,
  buildStudioPdfHash,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  isStudioPdfPageCountAllowed,
  MAX_STUDIO_PDF_PAGES,
  studioPanelRatioFromPointer,
  studioPdfSrc,
} from "./studio";

const studioDocument = {
  id: "doc-1",
  title: "Physics",
  original_filename: "physics.pdf",
  stored_file_path: "/tmp/physics.pdf",
  note_page_id: "note-1",
  project_id: null,
  last_opened_at: "2026-06-03T00:00:00.000Z",
  viewer_zoom: 125,
  viewer_page: 2,
  panel_layout: "pdf-left" as const,
  created_at: "2026-06-03T00:00:00.000Z",
  updated_at: "2026-06-03T00:00:00.000Z",
};

function withDesktopBridge(work: () => void): void {
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    openNotion: {
      invoke: async () => null,
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => `file://${filePath}`,
      studioPdfSrc: (documentId: string) => `http://127.0.0.1:49152/studio-document/${documentId}/source.pdf`,
    },
  };

  try {
    work();
  } finally {
    globalWithWindow.window = previousWindow;
  }
}

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

  it("accepts only bounded PDF page counts", () => {
    expect(isStudioPdfPageCountAllowed(1)).toBe(true);
    expect(isStudioPdfPageCountAllowed(MAX_STUDIO_PDF_PAGES)).toBe(true);
    expect(isStudioPdfPageCountAllowed(0)).toBe(false);
    expect(isStudioPdfPageCountAllowed(MAX_STUDIO_PDF_PAGES + 1)).toBe(false);
    expect(isStudioPdfPageCountAllowed(1.5)).toBe(false);
  });

  it("builds a PDF hash with persisted page and zoom", () => {
    expect(buildStudioPdfHash({ page: 3, zoom: 150 })).toBe("#page=3&zoom=150");
  });

  it("uses the dedicated Studio PDF bridge source before the raw file path", () => {
    withDesktopBridge(() => {
      expect(studioPdfSrc(studioDocument)).toBe("http://127.0.0.1:49152/studio-document/doc-1/source.pdf#page=2&zoom=125");
    });
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
