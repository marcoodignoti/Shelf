import type { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useState, type DragEvent } from "react";
import { coverImageSrc, importEditorImage, importEditorMedia, importEditorVideo } from "../lib/db";
import { isEmptyEditorBlock } from "../lib/editorDom";
import {
  dataTransferFiles,
  dataTransferHasSupportedMedia,
  insertEditorMediaBlocks,
} from "../lib/editorSlashMenu";
import {
  editorMediaBlockProps,
  editorMediaKindForFile,
  editorMediaUserMessage,
  type EditorMediaKind,
} from "../lib/editorMedia";
import {
  blocksFromPastedMathText,
  normalizeMathInlineContentInEditor,
  prepareMarkdownForBlockNotePaste,
  shouldUseBlockNoteMarkdownPaste,
} from "../lib/editorMath";
import type { TranslationKey, TranslationParams } from "../lib/i18n";

type ShowError = (error: unknown) => void;
type ShowSuccess = (key: TranslationKey, params?: TranslationParams) => void;
type Translate = (key: TranslationKey, params?: TranslationParams) => string;

type EditorPasteHandlerArgs = {
  event: ClipboardEvent;
  editor: BlockNoteEditor<any, any, any>;
  defaultPasteHandler: (context?: {
    prioritizeMarkdownOverHTML?: boolean;
    plainTextAsMarkdown?: boolean;
  }) => boolean | undefined;
};

export async function uploadEditorMediaFile(
  file: File,
  pageId: string,
  showError: ShowError,
): Promise<string> {
  try {
    const kind = editorMediaKindForFile(file);
    if (!kind) {
      throw new Error("Only image and video uploads are supported");
    }
    const importedPath = kind === "video"
      ? await importEditorVideo(file, pageId)
      : await importEditorImage(file, pageId);
    return coverImageSrc(importedPath);
  } catch (error) {
    showError(editorMediaUserMessage(error));
    throw error;
  }
}

export function handleEditorPasteWithMedia(
  { event, editor, defaultPasteHandler }: EditorPasteHandlerArgs,
  pageId: string,
  showError: ShowError,
): boolean | void {
  const mediaFiles = Array.from(event.clipboardData?.files ?? []).filter((file) => editorMediaKindForFile(file));
  const pastedText = event.clipboardData?.getData("text/plain") ?? "";
  const useBlockNoteMarkdownPaste = mediaFiles.length === 0 && shouldUseBlockNoteMarkdownPaste(pastedText);
  const mathBlocks = mediaFiles.length === 0 && !useBlockNoteMarkdownPaste ? blocksFromPastedMathText(pastedText) : null;

  if (useBlockNoteMarkdownPaste) {
    const blocks = editor.tryParseMarkdownToBlocks(prepareMarkdownForBlockNotePaste(pastedText));
    const cursorBlock = editor.getTextCursorPosition().block;
    if (isEmptyEditorBlock(cursorBlock)) {
      editor.replaceBlocks([cursorBlock], blocks as never);
    } else {
      editor.insertBlocks(blocks as never, cursorBlock, "after");
    }
    normalizeMathInlineContentInEditor(editor);
    return true;
  }

  if (mathBlocks) {
    const cursorBlock = editor.getTextCursorPosition().block;
    if (isEmptyEditorBlock(cursorBlock)) {
      editor.replaceBlocks([cursorBlock], mathBlocks as never);
    } else {
      editor.insertBlocks(mathBlocks as never, cursorBlock, "after");
    }
    return true;
  }

  if (mediaFiles.length === 0) {
    return defaultPasteHandler();
  }

  void Promise.all(
    mediaFiles.map(async (file) => {
      const kind = editorMediaKindForFile(file);
      if (!kind) throw new Error("Only image and video uploads are supported");

      const importedPath = kind === "video"
        ? await importEditorVideo(file, pageId)
        : await importEditorImage(file, pageId);
      return editorMediaBlockProps(kind, file.name, coverImageSrc(importedPath));
    })
  ).then((media) => {
    insertEditorMediaBlocks(editor, media);
  }).catch((error) => {
    showError(editorMediaUserMessage(error));
  });

  return true;
}

export function useEditorMediaDrop({
  editor,
  pageId,
  showError,
  showSuccess,
  t,
}: {
  editor: BlockNoteEditor<any, any, any>;
  pageId: string;
  showError: ShowError;
  showSuccess: ShowSuccess;
  t: Translate;
}) {
  const [isMediaDropActive, setIsMediaDropActive] = useState(false);

  const importDroppedMediaFiles = useCallback(
    async (files: File[]) => {
      const mediaFiles = files
        .map((file) => ({ file, kind: editorMediaKindForFile(file) }))
        .filter((item): item is { file: File; kind: EditorMediaKind } => item.kind !== null);

      if (mediaFiles.length === 0) {
        showError(t("editor.dropMediaHint"));
        return;
      }

      try {
        const media = await Promise.all(
          mediaFiles.map(async ({ file, kind }) => {
            const importedPath = await importEditorMedia(file, pageId);
            return editorMediaBlockProps(
              kind,
              file.name || (kind === "video" ? "Video" : "Image"),
              coverImageSrc(importedPath)
            );
          })
        );

        insertEditorMediaBlocks(editor, media);
        const count = String(media.length);
        showSuccess(
          media.length === 1 ? "editor.mediaImported" : "editor.mediaImportedPlural",
          { count }
        );
      } catch (error) {
        showError(editorMediaUserMessage(error));
      }
    },
    [editor, pageId, showError, showSuccess, t]
  );

  const handleMediaDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasSupportedMedia(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsMediaDropActive(true);
  }, []);

  const handleMediaDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setIsMediaDropActive(false);
  }, []);

  const handleMediaDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = dataTransferFiles(event.dataTransfer);
      if (files.length === 0) return;

      event.preventDefault();
      setIsMediaDropActive(false);
      void importDroppedMediaFiles(files);
    },
    [importDroppedMediaFiles]
  );

  return {
    handleMediaDragLeave,
    handleMediaDragOver,
    handleMediaDrop,
    isMediaDropActive,
  };
}
