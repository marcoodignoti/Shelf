import { useEffect, useRef, useState, type RefObject } from "react";
import { eventPathIncludesSelector, slashMenuElement } from "../../lib/editorSlashMenu";

/**
 * While BlockNote's slash menu is open: block page wheel scrolling outside the
 * menu and pin the editor scroll container where it was when the menu opened.
 * Returns whether the slash menu is currently open.
 */
export function useSlashMenuScrollLock({
  scrollContainerRef,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}): boolean {
  const slashMenuLockedScrollTopRef = useRef<number | null>(null);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const slashMenu = slashMenuElement();
      if (!slashMenu || eventPathIncludesSelector(event, ".bn-suggestion-menu")) return;

      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", handleWheel, { capture: true });
  }, []);

  useEffect(() => {
    const updateSlashMenuOpen = () => {
      const isOpen = Boolean(slashMenuElement());
      setIsSlashMenuOpen(isOpen);

      if (!isOpen) {
        slashMenuLockedScrollTopRef.current = null;
        return;
      }

      if (slashMenuLockedScrollTopRef.current === null) {
        slashMenuLockedScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? null;
      }
    };

    updateSlashMenuOpen();
    const observer = new MutationObserver(updateSlashMenuOpen);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return undefined;

    const keepSlashMenuScrollLocked = () => {
      if (!slashMenuElement()) return;

      const lockedScrollTop = slashMenuLockedScrollTopRef.current;
      if (lockedScrollTop === null) {
        slashMenuLockedScrollTopRef.current = scrollContainer.scrollTop;
        return;
      }

      if (Math.abs(scrollContainer.scrollTop - lockedScrollTop) >= 1) {
        scrollContainer.scrollTop = lockedScrollTop;
      }
    };

    scrollContainer.addEventListener("scroll", keepSlashMenuScrollLocked, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", keepSlashMenuScrollLocked);
  }, [scrollContainerRef]);

  return isSlashMenuOpen;
}
