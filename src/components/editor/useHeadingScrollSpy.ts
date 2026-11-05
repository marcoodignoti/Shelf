import type { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { blockElementSelector, type HeadingRailItem } from "../../lib/editorDom";
import { activeHeadingFromOffsets } from "../../lib/headingScrollSpy";

type UseHeadingScrollSpyOptions = {
  editor: BlockNoteEditor<any, any, any>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  headingItems: HeadingRailItem[];
};

/** Tracks which heading is in view and scrolls to a heading on request. */
export function useHeadingScrollSpy({ editor, scrollContainerRef, headingItems }: UseHeadingScrollSpyOptions) {
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(headingItems[0]?.id ?? null);
  const pendingHeadingScrollRef = useRef<{ id: string; clearTimer: number } | null>(null);

  const scrollToHeading = useCallback((headingId: string) => {
    const scrollContainer = scrollContainerRef.current;
    const headingElement = editor.domElement?.querySelector<HTMLElement>(blockElementSelector(headingId));
    if (!scrollContainer || !headingElement) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const headingRect = headingElement.getBoundingClientRect();
    const top = scrollContainer.scrollTop + headingRect.top - containerRect.top - 96;

    // Keep the clicked section active while the smooth scroll is in flight:
    // without this the scroll spy flips the highlight back to the previous
    // section on the first intermediate scroll event, and if the animation
    // is interrupted it never reaches the target section at all. The spy
    // resumes on scrollend (with a timer fallback for environments that
    // never fire it).
    if (pendingHeadingScrollRef.current) {
      window.clearTimeout(pendingHeadingScrollRef.current.clearTimer);
    }
    pendingHeadingScrollRef.current = {
      id: headingId,
      clearTimer: window.setTimeout(() => {
        pendingHeadingScrollRef.current = null;
      }, 1_500),
    };

    setActiveHeadingId(headingId);
    scrollContainer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [editor, scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || headingItems.length === 0) {
      setActiveHeadingId(null);
      return;
    }

    let frame = 0;

    const updateActiveHeading = () => {
      frame = 0;
      if (pendingHeadingScrollRef.current) return;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const current = activeHeadingFromOffsets(
        headingItems.map((item) => ({
          id: item.id,
          top: editor.domElement
            ?.querySelector<HTMLElement>(blockElementSelector(item.id))
            ?.getBoundingClientRect().top ?? null,
        })),
        containerTop,
      );

      setActiveHeadingId((previous) => previous === current ? previous : current);
    };

    const queueUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(updateActiveHeading);
    };

    const handleScrollEnd = () => {
      if (pendingHeadingScrollRef.current) {
        window.clearTimeout(pendingHeadingScrollRef.current.clearTimer);
        pendingHeadingScrollRef.current = null;
      }
      queueUpdate();
    };

    updateActiveHeading();
    scrollContainer.addEventListener("scroll", queueUpdate, { passive: true });
    scrollContainer.addEventListener("scrollend", handleScrollEnd, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      scrollContainer.removeEventListener("scroll", queueUpdate);
      scrollContainer.removeEventListener("scrollend", handleScrollEnd);
      window.removeEventListener("resize", queueUpdate);
    };
  }, [editor, headingItems, scrollContainerRef]);

  return { activeHeadingId, scrollToHeading };
}
