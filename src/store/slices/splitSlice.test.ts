// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../useAppStore";

function resetStore() {
  useAppStore.setState({
    pages: [
      { id: "p1", title: "A" },
      { id: "p2", title: "B" },
      { id: "p3", title: "C" },
    ] as any,
    currentPageId: "p1",
    secondaryPageId: null,
    splitViewRatio: 0.5,
    activePane: "primary",
  });
}

describe("splitSlice", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("openInSplit sets secondaryPageId without touching currentPageId", () => {
    useAppStore.getState().openInSplit("p2");
    const s = useAppStore.getState();
    expect(s.secondaryPageId).toBe("p2");
    expect(s.currentPageId).toBe("p1");
    expect(localStorage.getItem("opennotion-secondary-page-id")).toBe("p2");
  });

  it("openInSplit with the current page results in no split (sanitization)", () => {
    useAppStore.getState().openInSplit("p1");
    expect(useAppStore.getState().secondaryPageId).toBeNull();
  });

  it("swapSplit exchanges primary and secondary", () => {
    useAppStore.getState().openInSplit("p2");
    useAppStore.getState().swapSplit();
    const s = useAppStore.getState();
    expect(s.currentPageId).toBe("p2");
    expect(s.secondaryPageId).toBe("p1");
  });

  it("closeSplit clears secondaryPageId and storage", () => {
    useAppStore.getState().openInSplit("p2");
    useAppStore.getState().closeSplit();
    expect(useAppStore.getState().secondaryPageId).toBeNull();
    expect(localStorage.getItem("opennotion-secondary-page-id")).toBeNull();
  });

  it("setSplitViewRatio clamps to [0.2, 0.8] and persists", () => {
    useAppStore.getState().setSplitViewRatio(0.05);
    expect(useAppStore.getState().splitViewRatio).toBe(0.2);
    useAppStore.getState().setSplitViewRatio(0.95);
    expect(useAppStore.getState().splitViewRatio).toBe(0.8);
    useAppStore.getState().setSplitViewRatio(0.4);
    expect(useAppStore.getState().splitViewRatio).toBe(0.4);
    expect(localStorage.getItem("opennotion-split-ratio")).toBe("0.4");
  });

  it("setActivePane updates activePane", () => {
    useAppStore.getState().setActivePane("secondary");
    expect(useAppStore.getState().activePane).toBe("secondary");
  });

  it("openSplitPicker/closeSplitPicker toggle the flag", () => {
    expect(useAppStore.getState().isSplitPickerOpen).toBe(false);
    useAppStore.getState().openSplitPicker();
    expect(useAppStore.getState().isSplitPickerOpen).toBe(true);
    useAppStore.getState().closeSplitPicker();
    expect(useAppStore.getState().isSplitPickerOpen).toBe(false);
  });
});
