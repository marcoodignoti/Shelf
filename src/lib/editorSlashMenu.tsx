import { BlockNoteEditor } from "@blocknote/core";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import { FileText, Image, Sigma, Video } from "lucide-react";
import { coverImageSrc, importEditorImageFilesFromDialog, importEditorVideoFilesFromDialog, Page } from "./db";
import { insertPageLinkInlineContent } from "./editorLinks";
import { isEmptyEditorBlock } from "./editorDom";
import { editorMediaBlockProps, editorMediaKindForFile, editorMediaUserMessage, fileNameFromPath, type EditorMediaBlock, type EditorMediaKind } from "./editorMedia";
import { formulaSlashMenuItem } from "./editorMath";
import { type TranslationKey, type TranslationParams } from "./i18n";
import { rankedSuggestionItems } from "./slashSearch";

const urlEmbedMenuTitles = new Set(["audio", "embed", "file", "image", "video"]);

export function dataTransferFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? []);
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items ?? [])
    .map((item) => item.kind === "file" ? item.getAsFile() : null)
    .filter((file): file is File => file !== null);
}

export function dataTransferHasSupportedMedia(dataTransfer: DataTransfer): boolean {
  const files = dataTransferFiles(dataTransfer);
  if (files.some((file) => editorMediaKindForFile(file))) return true;

  return Array.from(dataTransfer.items ?? []).some((item) =>
    item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))
  );
}

export function insertEditorMediaBlocks(editor: BlockNoteEditor<any, any, any>, media: EditorMediaBlock[]) {
  const cursorBlock = editor.getTextCursorPosition().block;
  if (isEmptyEditorBlock(cursorBlock)) {
    editor.replaceBlocks([cursorBlock], media as never);
  } else {
    editor.insertBlocks(media as never, cursorBlock, "after");
  }
}

export function editorMediaSlashMenuItem(
  editor: BlockNoteEditor<any, any, any>,
  pageId: string,
  kind: EditorMediaKind,
  showError: (error: unknown) => void,
  showSuccess: (key: TranslationKey, params?: TranslationParams) => void,
  t: (key: TranslationKey, params?: TranslationParams) => string,
) {
  const isVideo = kind === "video";

  return {
    title: isVideo ? t("editor.slashVideo") : t("editor.slashImage"),
    subtext: t("editor.slashFromDevice"),
    group: t("editor.slashMediaGroup"),
	    icon: isVideo ? <Video size={18} /> : <Image size={18} />,
	    onItemClick: async () => {
	      try {
	        const imports = isVideo
	          ? await importEditorVideoFilesFromDialog(pageId)
	          : await importEditorImageFilesFromDialog(pageId);
	        if (imports.length === 0) return;
	        const media = imports.map((imported) => editorMediaBlockProps(
	          kind,
	          fileNameFromPath(imported.sourceName, isVideo ? "Video" : "Image"),
	          coverImageSrc(imported.path)
	        ));

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
  };
}

export function openNotionSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  pageId: string,
  showError: (error: unknown) => void,
  showSuccess: (key: TranslationKey, params?: TranslationParams) => void,
  t: (key: TranslationKey, params?: TranslationParams) => string,
) {
  const items = [
    ...getDefaultReactSlashMenuItems(editor).filter(
      (item) => !urlEmbedMenuTitles.has(String(item.title ?? "").toLowerCase())
    ),
    editorMediaSlashMenuItem(editor, pageId, "image", showError, showSuccess, t),
    editorMediaSlashMenuItem(editor, pageId, "video", showError, showSuccess, t),
    {
      ...formulaSlashMenuItem(editor),
      icon: <Sigma size={18} />,
    },
  ];

  return async (query: string) => rankedSuggestionItems(items, query);
}

function pageLinkKindLabel(page: Page, t: (key: TranslationKey) => string): string {
  return page.page_kind === "studio_note" ? t("editor.pageLinkKindStudio") : t("editor.pageLinkKindNote");
}

export function openNotionPageLinkItems(
  editor: BlockNoteEditor<any, any, any>,
  pages: Page[],
  currentPageId: string,
  t: (key: TranslationKey) => string,
) {
  return async (query: string) => {
    const candidates = pages
      .filter((candidate) => candidate.id !== currentPageId && candidate.is_deleted === 0)
      .map((candidate) => ({
        page: candidate,
        title: candidate.title || t("sidebar.untitled"),
        aliases: [
          candidate.page_kind === "studio_note" ? "studio" : "note",
          candidate.icon || "",
        ].filter(Boolean),
      }));

    return rankedSuggestionItems(candidates, query)
      .slice(0, 8)
      .map(({ page, title }) => ({
        title,
        subtext: pageLinkKindLabel(page, t),
        group: t("editor.slashPagesGroup"),
        icon: page.icon ? (
          <span className="flex h-[18px] w-[18px] items-center justify-center text-sm">{page.icon}</span>
        ) : (
          <FileText size={18} />
        ),
        onItemClick: () => {
          insertPageLinkInlineContent(editor, page);
        },
      }));
  };
}

export function eventPathIncludesSelector(event: Event, selector: string): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof Element && (target.matches(selector) || Boolean(target.closest(selector))));
}

export function slashMenuElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".bn-suggestion-menu");
}
