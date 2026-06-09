export type PageNavigationIntent = "previous" | "next" | null;

const SWIPE_MIN_DISTANCE = 64;
const SWIPE_AXIS_RATIO = 1.5;
const WHEEL_SWIPE_THRESHOLD = 160;

type ArrowKeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function arrowKeyPageIntent(event: ArrowKeyEventLike): PageNavigationIntent {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowLeft") return "previous";
  if (event.key === "ArrowRight") return "next";
  return null;
}

type TextEntryElementLike = {
  tagName?: string;
  closest?: (selector: string) => unknown;
};

export function isTextEntryElement(element: TextEntryElementLike | null): boolean {
  if (!element) return false;
  const tag = element.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return Boolean(element.closest?.("[contenteditable='true']"));
}

// Touch swipe: finger moving left (negative deltaX) pushes the content
// forward, like turning a page. The gesture must be clearly horizontal and
// long enough to be intentional.
export function swipePageIntent(
  deltaX: number,
  deltaY: number,
  options: { minDistance?: number; axisRatio?: number } = {}
): PageNavigationIntent {
  const minDistance = options.minDistance ?? SWIPE_MIN_DISTANCE;
  const axisRatio = options.axisRatio ?? SWIPE_AXIS_RATIO;

  if (Math.abs(deltaX) < minDistance) return null;
  if (Math.abs(deltaX) < Math.abs(deltaY) * axisRatio) return null;
  return deltaX < 0 ? "next" : "previous";
}

// Trackpad swipe via wheel deltaX (macOS natural scrolling: two-finger swipe
// left produces positive deltaX and should move forward, matching Preview).
// While the viewer can still scroll horizontally in the gesture's direction,
// the gesture is a scroll, not a page turn — paging only happens at the edge.
export function wheelSwipePageIntent(
  accumulatedDeltaX: number,
  edges: { canScrollLeft: boolean; canScrollRight: boolean },
  threshold: number = WHEEL_SWIPE_THRESHOLD
): PageNavigationIntent {
  if (accumulatedDeltaX >= threshold && !edges.canScrollRight) return "next";
  if (accumulatedDeltaX <= -threshold && !edges.canScrollLeft) return "previous";
  return null;
}

export function pageForNavigationIntent(intent: PageNavigationIntent, currentPage: number): number | null {
  if (intent === "next") return currentPage + 1;
  if (intent === "previous") return currentPage - 1;
  return null;
}
