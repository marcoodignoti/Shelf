import { describe, expect, it } from "vitest";
import {
  arrowKeyPageIntent,
  isTextEntryElement,
  pageForNavigationIntent,
  swipePageIntent,
  wheelSwipePageIntent,
} from "./pdfNavigation";

const noModifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("arrowKeyPageIntent", () => {
  it("maps plain arrow keys to page intents", () => {
    expect(arrowKeyPageIntent({ key: "ArrowLeft", ...noModifiers })).toBe("previous");
    expect(arrowKeyPageIntent({ key: "ArrowRight", ...noModifiers })).toBe("next");
  });

  it("ignores other keys", () => {
    expect(arrowKeyPageIntent({ key: "ArrowUp", ...noModifiers })).toBeNull();
    expect(arrowKeyPageIntent({ key: "a", ...noModifiers })).toBeNull();
    expect(arrowKeyPageIntent({ key: "PageDown", ...noModifiers })).toBeNull();
  });

  it("ignores arrows with any modifier held", () => {
    expect(arrowKeyPageIntent({ key: "ArrowRight", ...noModifiers, metaKey: true })).toBeNull();
    expect(arrowKeyPageIntent({ key: "ArrowRight", ...noModifiers, ctrlKey: true })).toBeNull();
    expect(arrowKeyPageIntent({ key: "ArrowLeft", ...noModifiers, altKey: true })).toBeNull();
    expect(arrowKeyPageIntent({ key: "ArrowLeft", ...noModifiers, shiftKey: true })).toBeNull();
  });
});

describe("isTextEntryElement", () => {
  const element = (tagName: string, insideContentEditable = false) => ({
    tagName,
    closest: (selector: string) =>
      insideContentEditable && selector === "[contenteditable='true']" ? {} : null,
  });

  it("detects inputs and textareas", () => {
    expect(isTextEntryElement(element("INPUT"))).toBe(true);
    expect(isTextEntryElement(element("input"))).toBe(true);
    expect(isTextEntryElement(element("TEXTAREA"))).toBe(true);
  });

  it("detects elements inside contenteditable", () => {
    expect(isTextEntryElement(element("P", true))).toBe(true);
    expect(isTextEntryElement(element("DIV", true))).toBe(true);
  });

  it("rejects plain elements and null", () => {
    expect(isTextEntryElement(element("DIV"))).toBe(false);
    expect(isTextEntryElement(element("BUTTON"))).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
  });
});

describe("swipePageIntent", () => {
  it("turns a long leftward swipe into next", () => {
    expect(swipePageIntent(-120, 10)).toBe("next");
  });

  it("turns a long rightward swipe into previous", () => {
    expect(swipePageIntent(120, -8)).toBe("previous");
  });

  it("ignores short swipes", () => {
    expect(swipePageIntent(-40, 0)).toBeNull();
    expect(swipePageIntent(63, 0)).toBeNull();
  });

  it("ignores mostly-vertical gestures (scrolling)", () => {
    expect(swipePageIntent(-80, 90)).toBeNull();
    expect(swipePageIntent(80, -70)).toBeNull();
  });

  it("respects custom thresholds", () => {
    expect(swipePageIntent(-30, 0, { minDistance: 20 })).toBe("next");
  });
});

describe("wheelSwipePageIntent", () => {
  const atEdges = { canScrollLeft: false, canScrollRight: false };

  it("pages forward on accumulated positive deltaX", () => {
    expect(wheelSwipePageIntent(180, atEdges)).toBe("next");
  });

  it("pages back on accumulated negative deltaX", () => {
    expect(wheelSwipePageIntent(-200, atEdges)).toBe("previous");
  });

  it("does nothing below the threshold", () => {
    expect(wheelSwipePageIntent(120, atEdges)).toBeNull();
    expect(wheelSwipePageIntent(-159, atEdges)).toBeNull();
  });

  it("never pages while the viewer can still scroll in that direction", () => {
    expect(wheelSwipePageIntent(500, { canScrollLeft: false, canScrollRight: true })).toBeNull();
    expect(wheelSwipePageIntent(-500, { canScrollLeft: true, canScrollRight: false })).toBeNull();
  });

  it("pages in one direction while the other is still scrollable", () => {
    expect(wheelSwipePageIntent(200, { canScrollLeft: true, canScrollRight: false })).toBe("next");
    expect(wheelSwipePageIntent(-200, { canScrollLeft: false, canScrollRight: true })).toBe("previous");
  });
});

describe("pageForNavigationIntent", () => {
  it("computes the target page", () => {
    expect(pageForNavigationIntent("next", 3)).toBe(4);
    expect(pageForNavigationIntent("previous", 3)).toBe(2);
    expect(pageForNavigationIntent(null, 3)).toBeNull();
  });
});
