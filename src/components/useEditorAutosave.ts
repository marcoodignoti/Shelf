import type { Block, BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { updatePage, type Page } from "../lib/db";
import { editorSaveReducer, errorMessage } from "../lib/editorSaveState";
import { pageContentToSearchText } from "../lib/pageContent";

const SAVE_DEBOUNCE_MS = 300;

type UseEditorAutosaveOptions = {
  pageId: string;
  editor: BlockNoteEditor<any, any, any>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
};

export function useEditorAutosave({
  pageId,
  editor,
  updatePageOptimistically,
}: UseEditorAutosaveOptions) {
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Partial<Page>>({});
  // Content edits only mark this flag; serialization of the whole document is
  // deferred to the debounced flush so typing never pays JSON.stringify +
  // search-text extraction per keystroke.
  const contentDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const [saveState, dispatchSaveState] = useReducer(editorSaveReducer, { status: "saved" });

  const clearSaveTimeout = useCallback(() => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);

  const collectDirtyContent = useCallback((options: { optimistic?: boolean } = {}) => {
    if (!contentDirtyRef.current) return;

    contentDirtyRef.current = false;
    const content = JSON.stringify(editor.document as Block[]);
    const search_text = pageContentToSearchText(content);
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, content, search_text };
    if (options.optimistic !== false) {
      updatePageOptimistically(pageId, { content, search_text });
    }
  }, [editor, pageId, updatePageOptimistically]);

  const saveNow = useCallback(async () => {
    if (isSavingRef.current) return;

    collectDirtyContent();

    const updates = pendingUpdatesRef.current;
    if (Object.keys(updates).length === 0) return;

    pendingUpdatesRef.current = {};
    isSavingRef.current = true;
    dispatchSaveState({ type: "saving" });

    try {
      await updatePage(pageId, updates);
      isSavingRef.current = false;

      if (Object.keys(pendingUpdatesRef.current).length > 0 || contentDirtyRef.current) {
        dispatchSaveState({ type: "edit" });
        clearSaveTimeout();
        saveTimeoutRef.current = window.setTimeout(() => {
          void saveNow();
        }, SAVE_DEBOUNCE_MS);
      } else {
        dispatchSaveState({ type: "saved" });
      }
    } catch (error: unknown) {
      isSavingRef.current = false;
      dispatchSaveState({ type: "failed", message: errorMessage(error) });
      console.error("Failed to save page:", error);
    }
  }, [clearSaveTimeout, collectDirtyContent, pageId]);

  const queueSave = useCallback((updates: Partial<Page>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    updatePageOptimistically(pageId, updates);
    dispatchSaveState({ type: "edit" });

    clearSaveTimeout();
    saveTimeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [clearSaveTimeout, pageId, saveNow, updatePageOptimistically]);

  const queueContentSave = useCallback(() => {
    contentDirtyRef.current = true;
    dispatchSaveState({ type: "edit" });

    clearSaveTimeout();
    saveTimeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [clearSaveTimeout, saveNow]);

  const flushSaveNow = useCallback(() => {
    clearSaveTimeout();
    void saveNow();
  }, [clearSaveTimeout, saveNow]);

  const markSaveFailed = useCallback((error: unknown) => {
    dispatchSaveState({ type: "failed", message: errorMessage(error) });
  }, []);

  useEffect(() => {
    pendingUpdatesRef.current = {};
    contentDirtyRef.current = false;
    isSavingRef.current = false;
    dispatchSaveState({ type: "saved" });

    return () => {
      clearSaveTimeout();
      // Flush pending edits before the editor unmounts or re-keys to another
      // page. This cleanup closure still holds the previous pageId and the
      // previous editor instance, so a debounced edit made shortly before
      // navigation is persisted, not lost.
      collectDirtyContent({ optimistic: false });
      const pending = pendingUpdatesRef.current;
      if (Object.keys(pending).length === 0) return;

      pendingUpdatesRef.current = {};
      // Keep the store in sync so navigating back to this page renders the
      // final edit instead of the last flushed snapshot.
      updatePageOptimistically(pageId, pending);
      // Fire-and-forget on unmount: there is no UI left to roll back to, so at
      // least log a failed final write instead of dropping it silently.
      void updatePage(pageId, pending).catch((error) => {
        console.error("Failed to flush pending edits on page switch:", error);
      });
    };
  }, [clearSaveTimeout, collectDirtyContent, editor, pageId, updatePageOptimistically]);

  return {
    flushSaveNow,
    markSaveFailed,
    queueContentSave,
    queueSave,
    saveState,
  };
}
