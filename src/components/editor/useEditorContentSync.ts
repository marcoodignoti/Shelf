import type { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Page } from "../../lib/db";
import { activeElementIsNativeTextInput, keepEditorCaretInView } from "../../lib/editorDom";
import { syncPageLinkInlineContentInEditor } from "../../lib/editorLinks";
import { normalizeMathInlineContentInEditor } from "../../lib/editorMath";

type UseEditorContentSyncOptions = {
  editor: BlockNoteEditor<any, any, any>;
  pageId: string;
  pages: Page[];
  queueContentSave: () => void;
  lastInteractionTypeRef: RefObject<"pointer" | "keyboard">;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Keeps editor content normalized (inline math) and in sync with page
 * metadata (inline page links), queueing a save whenever either rewrites the
 * document. Returns the BlockNote onChange handler.
 */
export function useEditorContentSync({
  editor,
  pageId,
  pages,
  queueContentSave,
  lastInteractionTypeRef,
  scrollContainerRef,
}: UseEditorContentSyncOptions) {
  const isNormalizingMathRef = useRef(false);

  const handleEditorChange = useCallback(() => {
    if (!isNormalizingMathRef.current) {
      isNormalizingMathRef.current = true;
      const normalized = normalizeMathInlineContentInEditor(editor);
      isNormalizingMathRef.current = false;

      if (normalized) return;
    }

    queueContentSave();
    if (activeElementIsNativeTextInput()) return;
    if (lastInteractionTypeRef.current !== "keyboard") return;
    keepEditorCaretInView(editor, scrollContainerRef.current);
  }, [editor, lastInteractionTypeRef, queueContentSave, scrollContainerRef]);



  useEffect(() => {
    isNormalizingMathRef.current = true;
    const normalized = normalizeMathInlineContentInEditor(editor);
    isNormalizingMathRef.current = false;

    if (!normalized) return;

    queueContentSave();
  }, [editor, pageId, queueContentSave]);

  // Re-sync inline page links only when a page's identity fields change, not
  // on every pages-array identity change (e.g. our own debounced content
  // flush): the sync walks the whole document.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pageLinkSyncSignature = useMemo(
    () =>
      pages
        .map((candidate) => [candidate.id, candidate.title ?? "", candidate.icon ?? "", candidate.page_kind ?? ""].join("\u0000"))
        .join("\u0001"),
    [pages]
  );

  useEffect(() => {
    const synced = syncPageLinkInlineContentInEditor(editor, pagesRef.current);
    if (!synced) return;

    queueContentSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pagesRef tracks pages; pageLinkSyncSignature captures the fields the sync reads
  }, [editor, pageLinkSyncSignature, queueContentSave]);

  return { handleEditorChange };
}
