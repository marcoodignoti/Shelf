import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoredPanelRatio,
  getStoredPdfDisplayMode,
  getStoredViewMode,
  storePanelRatio,
  storePdfDisplayMode,
  storeViewMode,
} from "./studioWorkspacePrefs";

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    },
  });
}

describe("studio workspace preferences", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("stores clamped panel ratios per document", () => {
    storePanelRatio("doc-1", 95);

    expect(getStoredPanelRatio("doc-1")).toBe(70);
    expect(getStoredPanelRatio("missing")).toBe(30);
  });

  it("falls back from invalid stored view modes", () => {
    storeViewMode("doc-1", "note");
    storePdfDisplayMode("doc-1", "two-page");
    localStorage.setItem("opennotion-studio-view-mode-bad", "sideways");
    localStorage.setItem("opennotion-studio-pdf-display-mode-bad", "grid");

    expect(getStoredViewMode("doc-1")).toBe("note");
    expect(getStoredPdfDisplayMode("doc-1")).toBe("two-page");
    expect(getStoredViewMode("bad")).toBe("split");
    expect(getStoredPdfDisplayMode("bad")).toBe("continuous");
  });
});
