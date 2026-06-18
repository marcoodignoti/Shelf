import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Page } from "../lib/db";
import {
  orderedSubpageIdsFromDropTarget,
  subpageDropTargetFromRow,
  type EditorSubpageDropTarget,
} from "../lib/editorSubpageDrag";

type SubpageDragSession = {
  pageId: string;
  startX: number;
  startY: number;
  active: boolean;
};

type UseSubpageDragOptions = {
  childPages: Page[];
  pageId: string;
  reorderPagesAction: (parentId: string | null, orderedIds: string[]) => Promise<void>;
};

export function useSubpageDrag({
  childPages,
  pageId,
  reorderPagesAction,
}: UseSubpageDragOptions) {
  const [draggedSubpageId, setDraggedSubpageId] = useState<string | null>(null);
  const [subpageDropTarget, setSubpageDropTarget] = useState<EditorSubpageDropTarget | null>(null);
  const subpageDragSessionRef = useRef<SubpageDragSession | null>(null);
  const subpageDropTargetRef = useRef<EditorSubpageDropTarget | null>(null);

  const clearSubpageDragState = useCallback(() => {
    setDraggedSubpageId(null);
    setSubpageDropTarget(null);
    subpageDropTargetRef.current = null;
  }, []);

  const reorderSubpagesFromDropTarget = useCallback(async (sourceId: string, target: EditorSubpageDropTarget) => {
    const siblingIds = childPages.map((childPage) => childPage.id);
    const orderedIds = orderedSubpageIdsFromDropTarget(siblingIds, sourceId, target);
    if (!orderedIds) return;

    await reorderPagesAction(pageId, orderedIds);
  }, [childPages, pageId, reorderPagesAction]);

  const updateSubpageDropTarget = useCallback((sourceId: string, clientX: number, clientY: number) => {
    const row = window.document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-subpage-row-id]") ?? null;
    const nextTarget = subpageDropTargetFromRow(row, sourceId, clientY);
    if (!nextTarget) {
      subpageDropTargetRef.current = null;
      setSubpageDropTarget(null);
      return;
    }

    subpageDropTargetRef.current = nextTarget;
    setSubpageDropTarget(nextTarget);
  }, []);

  const handleSubpagePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, subpageId: string) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    event.preventDefault();
    event.stopPropagation();

    subpageDragSessionRef.current = {
      pageId: subpageId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = subpageDragSessionRef.current;
      if (!session) return;

      const distance = Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY);
      if (!session.active && distance < 4) return;

      if (!session.active) {
        subpageDragSessionRef.current = { ...session, active: true };
        setDraggedSubpageId(session.pageId);
        window.document.body.style.cursor = "grabbing";
        window.document.body.style.userSelect = "none";
      }

      moveEvent.preventDefault();
      updateSubpageDropTarget(session.pageId, moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = () => {
      const session = subpageDragSessionRef.current;
      const target = subpageDropTargetRef.current;
      subpageDragSessionRef.current = null;
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
      clearSubpageDragState();

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      if (session?.active && target) {
        void reorderSubpagesFromDropTarget(session.pageId, target);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, [clearSubpageDragState, reorderSubpagesFromDropTarget, updateSubpageDropTarget]);

  return {
    draggedSubpageId,
    handleSubpagePointerDown,
    subpageDropTarget,
  };
}
