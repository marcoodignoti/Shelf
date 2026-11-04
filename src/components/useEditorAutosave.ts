import type { Block, BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { updatePage, type Page } from "../lib/db";
import { editorSaveReducer, errorMessage } from "../lib/editorSaveState";
import { pageContentToSearchText } from "../lib/pageContent";
import {
  clearPendingPageUpdates,
  readPendingPageUpdates,
  writePendingPageUpdates,
} from "../lib/pendingPageSaves";

const SAVE_DEBOUNCE_MS = 300;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;
const UNSAVED_CHANGES_WARNING = "You have unsaved changes.";

type UseEditorAutosaveOptions = {
  pageId: string;
  editor: BlockNoteEditor<any, any, any>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
};

type SaveNowOptions = {
  optimistic?: boolean;
};

function hasUpdates(updates: Partial<Page>): boolean {
  return Object.keys(updates).length > 0;
}

// True when every field in `stored` has the same value in `sent`, i.e. the
// persisted record holds nothing newer than what the backend just accepted.
function isSubsetOf(stored: Partial<Page>, sent: Partial<Page>): boolean {
  return (Object.keys(stored) as (keyof Page)[]).every(
    (key) => key in sent && JSON.stringify(stored[key]) === JSON.stringify(sent[key]),
  );
}

export function useEditorAutosave({
  pageId,
  editor,
  updatePageOptimistically,
}: UseEditorAutosaveOptions) {
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Partial<Page>>({});
  const inFlightUpdatesRef = useRef<Partial<Page> | null>(null);
  // Content edits only mark this flag; serialization of the whole document is
  // deferred to the debounced flush so typing never pays JSON.stringify +
  // search-text extraction per keystroke.
  const contentDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const disposedRef = useRef(false);
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const saveNowRef = useRef<((options?: SaveNowOptions) => Promise<boolean>) | null>(null);
  const [saveState, dispatchSaveState] = useReducer(editorSaveReducer, { status: "saved" });

  const dispatch = useCallback((action: Parameters<typeof dispatchSaveState>[0]) => {
    if (mountedRef.current) dispatchSaveState(action);
  }, []);

  const clearSaveTimeout = useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);

  const persistPendingUpdates = useCallback(() => {
    const updates = {
      ...(inFlightUpdatesRef.current ?? {}),
      ...pendingUpdatesRef.current,
    };

    try {
      if (hasUpdates(updates)) {
        writePendingPageUpdates(pageId, updates);
      } else {
        clearPendingPageUpdates(pageId);
      }
    } catch (error: unknown) {
      // A full/disabled localStorage must not clear the in-memory queue. The
      // save status exposes the failure while the page remains marked dirty.
      dispatch({ type: "failed", message: errorMessage(error) });
      console.error("Failed to persist pending page edits:", error);
    }
  }, [dispatch, pageId]);

  const collectDirtyContent = useCallback((options: { optimistic?: boolean } = {}) => {
    if (!contentDirtyRef.current) return;

    const content = JSON.stringify(editor.document as Block[]);
    const search_text = pageContentToSearchText(content);
    contentDirtyRef.current = false;
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, content, search_text };
    if (options.optimistic !== false) {
      updatePageOptimistically(pageId, { content, search_text });
    }
  }, [editor, pageId, updatePageOptimistically]);

  const scheduleSave = useCallback((delayMs: number) => {
    clearSaveTimeout();
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void saveNowRef.current?.();
    }, delayMs);
  }, [clearSaveTimeout]);

  const saveNow = useCallback((options: SaveNowOptions = {}): Promise<boolean> => {
    if (isSavingRef.current) {
      return inFlightSaveRef.current ?? Promise.resolve(false);
    }

    collectDirtyContent({ optimistic: options.optimistic !== false });
    const updates = pendingUpdatesRef.current;
    if (!hasUpdates(updates)) return Promise.resolve(true);

    // Keep the snapshot in-flight until the IPC/DB write succeeds. New edits
    // arriving while it is pending stay in pendingUpdatesRef and are merged
    // after the result, so a failed write can never erase them.
    pendingUpdatesRef.current = {};
    inFlightUpdatesRef.current = updates;
    isSavingRef.current = true;
    persistPendingUpdates();
    dispatch({ type: "saving" });

    const request = (async (): Promise<boolean> => {
      try {
        await updatePage(pageId, updates);
        inFlightUpdatesRef.current = null;
        isSavingRef.current = false;
        retryAttemptRef.current = 0;
        // A content edit may have arrived while the previous snapshot was in
        // flight. Serialize it before clearing the completed snapshot from
        // localStorage, keeping the short debounce window crash-safe too.
        collectDirtyContent({ optimistic: false });
        persistPendingUpdates();

        if (hasUpdates(pendingUpdatesRef.current) || contentDirtyRef.current) {
          dispatch({ type: "edit" });
          if (!disposedRef.current) scheduleSave(SAVE_DEBOUNCE_MS);
        } else {
          dispatch({ type: "saved" });
        }
        return true;
      } catch (error: unknown) {
        isSavingRef.current = false;
        inFlightUpdatesRef.current = null;
        // The failed snapshot is restored before newer edits, preserving the
        // newest value for each field while retaining every unsaved field.
        pendingUpdatesRef.current = { ...updates, ...pendingUpdatesRef.current };
        persistPendingUpdates();
        retryAttemptRef.current += 1;
        dispatch({ type: "failed", message: errorMessage(error) });
        console.error("Failed to save page:", error);

        const retryDelay = Math.min(
          RETRY_MAX_DELAY_MS,
          RETRY_BASE_DELAY_MS * 2 ** Math.min(retryAttemptRef.current - 1, 10),
        );
        if (!disposedRef.current) scheduleSave(retryDelay);
        return false;
      }
    })();
    inFlightSaveRef.current = request;
    void request.finally(() => {
      if (inFlightSaveRef.current === request) inFlightSaveRef.current = null;
    });
    return request;
  }, [collectDirtyContent, dispatch, pageId, persistPendingUpdates, scheduleSave]);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const queueSave = useCallback((updates: Partial<Page>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    updatePageOptimistically(pageId, updates);
    persistPendingUpdates();
    retryAttemptRef.current = 0;
    dispatch({ type: "edit" });
    scheduleSave(SAVE_DEBOUNCE_MS);
  }, [dispatch, pageId, persistPendingUpdates, scheduleSave, updatePageOptimistically]);

  const queueContentSave = useCallback(() => {
    contentDirtyRef.current = true;
    retryAttemptRef.current = 0;
    dispatch({ type: "edit" });
    clearSaveTimeout();
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void saveNowRef.current?.();
    }, SAVE_DEBOUNCE_MS);
  }, [clearSaveTimeout, dispatch]);

  const flushSaveNow = useCallback(async (): Promise<boolean> => {
    clearSaveTimeout();
    // Drain an in-flight request and one follow-up batch before a destructive
    // operation (such as version restore) proceeds. Returning false keeps
    // the local queue intact and prevents an older edit overwriting the
    // restored version later.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const saved = await saveNow();
      if (!saved) return false;
      if (!contentDirtyRef.current && !hasUpdates(pendingUpdatesRef.current)) {
        return true;
      }
    }
    return !contentDirtyRef.current && !hasUpdates(pendingUpdatesRef.current);
  }, [clearSaveTimeout, saveNow]);

  const markSaveFailed = useCallback((error: unknown) => {
    dispatch({ type: "failed", message: errorMessage(error) });
  }, [dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    disposedRef.current = false;
    pendingUpdatesRef.current = {};
    inFlightUpdatesRef.current = null;
    inFlightSaveRef.current = null;
    contentDirtyRef.current = false;
    isSavingRef.current = false;
    retryAttemptRef.current = 0;
    dispatchSaveState({ type: "saved" });

    const persistedUpdates = readPendingPageUpdates(pageId);
    if (persistedUpdates) {
      pendingUpdatesRef.current = persistedUpdates;
      updatePageOptimistically(pageId, persistedUpdates);
      dispatchSaveState({ type: "edit" });
      scheduleSave(SAVE_DEBOUNCE_MS);
    }

    const persistForLifecycle = () => {
      collectDirtyContent({ optimistic: false });
      persistPendingUpdates();
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      persistForLifecycle();
      const hasPendingWork =
        contentDirtyRef.current ||
        hasUpdates(pendingUpdatesRef.current) ||
        hasUpdates(inFlightUpdatesRef.current ?? {});
      if (hasPendingWork) {
        event.preventDefault();
        // Chromium shows its standard localized confirmation text. This
        // return value is retained for browsers that still display custom text.
        event.returnValue = UNSAVED_CHANGES_WARNING;
      }
    };

    const handlePageHide = () => {
      persistForLifecycle();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      mountedRef.current = false;
      disposedRef.current = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      clearSaveTimeout();
      // Persist before React tears down the editor so a crash mid-write is
      // still recoverable on the next mount of this page.
      persistForLifecycle();

      // Then flush to the backend. Switching to another page must not leave
      // edits stranded in localStorage until this page is reopened (search,
      // backup and export read the DB). Chain after any in-flight write to
      // keep ordering; on failure the localStorage record stays for retry.
      const finalUpdates = {
        ...(inFlightUpdatesRef.current ?? {}),
        ...pendingUpdatesRef.current,
      };
      if (hasUpdates(finalUpdates)) {
        updatePageOptimistically(pageId, finalUpdates);
        const previous = inFlightSaveRef.current ?? Promise.resolve(true);
        void previous
          .then(() => updatePage(pageId, finalUpdates))
          .then(() => {
            const stored = readPendingPageUpdates(pageId);
            if (stored && isSubsetOf(stored, finalUpdates)) clearPendingPageUpdates(pageId);
          })
          .catch((error: unknown) => {
            console.error("Failed to flush page edits on unmount:", error);
          });
      }
    };
  }, [
    clearSaveTimeout,
    collectDirtyContent,
    dispatch,
    pageId,
    persistPendingUpdates,
    scheduleSave,
    updatePageOptimistically,
  ]);

  return {
    flushSaveNow,
    markSaveFailed,
    queueContentSave,
    queueSave,
    saveState,
  };
}
