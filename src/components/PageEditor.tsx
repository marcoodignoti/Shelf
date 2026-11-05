import { Block, BlockNoteEditor } from "@blocknote/core";
import { en as blockNoteLocaleEn, it as blockNoteLocaleIt } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";
import { FormattingToolbarController, SideMenuController, SuggestionMenuController, useEditorState } from "@blocknote/react";
import { AlertTriangle, Copy, FileText, GripVertical, History, Image, MoreHorizontal, PlusCircle, Smile, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseRowPropertiesPanel, DatabaseTableView } from "./DatabaseTableView";
import { disableSpellcheck, headingItemsFromBlocks, isNativeTextInput } from "../lib/editorDom";
import { pageBreadcrumb } from "../lib/breadcrumb";
import { showCharacterPalette } from "../lib/desktop";
import { coverImageSrc, getPage, importCoverImageFromDialog, Page } from "../lib/db";
import { databaseParentPageForEditor, templatePagesForEditor } from "../lib/editorPageCollections";
import { useLocale, useT } from "../lib/i18n";
import { OPEN_PAGE_LINK_EVENT } from "../lib/editorLinks";
import { openNotionEditorSchema } from "../lib/editorMath";
import { parsePageBlocks } from "../lib/pageContent";
import { normalizeCoverUrl, normalizePageIcon } from "../lib/pageMetadata";
import { readPendingPageUpdates } from "../lib/pendingPageSaves";
import { initialEditorFields } from "../lib/pageEditorInitialFields";
import { PageHeadingRail } from "./editor/PageHeadingRail";
import { useHeadingScrollSpy } from "./editor/useHeadingScrollSpy";
import { ShelfFormattingToolbar, ShelfSideMenu } from "./editor/EditorToolbars";
import { SubpageCreateMenu } from "./editor/SubpageCreateMenu";
import { useEditorContentSync } from "./editor/useEditorContentSync";
import { useSlashMenuScrollLock } from "./editor/useSlashMenuScrollLock";
import { PageEditorTopBar } from "./editor/PageEditorTopBar";
import { titleBeforeInputAction, titleEnterShouldInsertNewline } from "../lib/editorTitleInput";
import { childPagesForParent } from "../lib/pageTree";
import { subpageSectionMode } from "../lib/subpageSection";
import { openNotionPageLinkItems, openNotionSlashMenuItems } from "../lib/editorSlashMenu";
import { useAppStore } from "../store/useAppStore";
import { useUIStore } from "../store/useUIStore";
import { FloatingPopover } from "./FloatingPopover";
import { PageHistoryDialog } from "./PageHistoryDialog";
import { SubpageActionsMenu } from "./SubpageActionsMenu";
import { useEditorAutosave } from "./useEditorAutosave";
import { handleEditorPasteWithMedia, uploadEditorMediaFile, useEditorMediaDrop } from "./useEditorMediaImport";
import { usePageActions } from "./usePageActions";
import { useSubpageActions } from "./useSubpageActions";
import { useSubpageDrag } from "./useSubpageDrag";

const ICON_OPTIONS = ["📄", "✅", "💡", "📌", "🚀", "🧠", "🛠️", "📚", "🎯", "✨", "🔥", "📝"];

export function Editor(props: {
  page: Page;
  pages: Page[];
  onSelectPage: (id: string) => void;
  variant?: "page" | "studio";
  inSplit?: boolean;
}) {
  const { page } = props;
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const showError = useAppStore((state) => state.showError);
  const t = useT();

  useEffect(() => {
    if (page.content_loaded !== 0) return;
    let cancelled = false;
    getPage(page.id)
      .then((fullPage) => {
        if (cancelled || !fullPage) return;
        updatePageOptimistically(fullPage.id, fullPage);
      })
      .catch((error: unknown) => {
        if (!cancelled) showError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [page.content_loaded, page.id, showError, updatePageOptimistically]);

  if (page.content_loaded === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("common.loadingWorkspace")}
      </div>
    );
  }

  // A restored version changes updated_at. Recreate BlockNote from that
  // canonical content so its previous in-memory document cannot be saved on
  // top of the restored version.
  return <EditorSurface key={`${page.id}:${page.updated_at}`} {...props} />;
}

function EditorSurface({
  page,
  pages,
  onSelectPage,
  variant = "page",
  inSplit = false,
}: {
  page: Page;
  pages: Page[];
  onSelectPage: (id: string) => void;
  variant?: "page" | "studio";
  inSplit?: boolean;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const [sideMenuPortalEl, setSideMenuPortalEl] = useState<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const titleEnterModifierRef = useRef(false);
  const lastInteractionTypeRef = useRef<"pointer" | "keyboard">("pointer");
  const iconMenuButtonRef = useRef<HTMLButtonElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const pageMenuButtonRef = useRef<HTMLButtonElement>(null);
  const subpageMenuButtonRef = useRef<HTMLButtonElement>(null);
  // A failed autosave is restored from localStorage before the editor is
  // created, so a reload immediately shows the user's last local edits.
  const pendingPageUpdates = useMemo(() => readPendingPageUpdates(page.id), [page.id]);
  const initialFields = initialEditorFields(page, pendingPageUpdates);
  const [title, setTitle] = useState(initialFields.title);
  const [icon, setIcon] = useState(initialFields.icon);
  const [coverUrl, setCoverUrl] = useState(initialFields.coverUrl);
  const [isIconMenuOpen, setIsIconMenuOpen] = useState(false);
  const [isCoverInputOpen, setIsCoverInputOpen] = useState(false);
  const [subpageMenuOpen, setSubpageMenuOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [isPageHistoryOpen, setIsPageHistoryOpen] = useState(false);
  const [isSplitMenuOpen, setIsSplitMenuOpen] = useState(false);
  const splitButtonRef = useRef<HTMLButtonElement>(null);
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const addPage = useAppStore((state) => state.addPage);
  const addPageFromTemplate = useAppStore((state) => state.addPageFromTemplate);
  const duplicatePageAction = useAppStore((state) => state.duplicatePageAction);
  const movePageAction = useAppStore((state) => state.movePageAction);
  const reorderPagesAction = useAppStore((state) => state.reorderPagesAction);
  const removePage = useAppStore((state) => state.removePage);
  const deleteStudioDocumentAction = useAppStore((state) => state.deleteStudioDocumentAction);
  const studioDocuments = useAppStore((state) => state.studioDocuments);
  const toggleFavoriteAction = useAppStore((state) => state.toggleFavoriteAction);
  const toggleTemplateAction = useAppStore((state) => state.toggleTemplateAction);
  const showError = useAppStore((state) => state.showError);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const appTheme = useUIStore((state) => state.theme);
  const editorFont = useUIStore((state) => state.editorFont);
  const editorFontSize = useUIStore((state) => state.editorFontSize);
  const pageWidth = useUIStore((state) => state.pageWidth);
  const titleEnterBehavior = useUIStore((state) => state.titleEnterBehavior);
  const locale = useLocale();
  const t = useT();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  // `locale` is a dependency because a language change recreates the editor:
  // re-parse the latest store content so the new editor does not reset the
  // document to the snapshot taken when the page was opened.
  const pendingContent = initialFields.content;
  const initialContent = useMemo(
    () => parsePageBlocks(pendingContent ?? page.content),
    [page.id, locale, pendingContent],
  );
  const breadcrumbs = useMemo(() => pageBreadcrumb(pages, page.id), [page.id, pages]);
  const databaseParentPage = useMemo(() => databaseParentPageForEditor(pages, page), [page, pages]);
  const childPages = useMemo(() => childPagesForParent(pages, page.id), [page.id, pages]);
  const templatePages = useMemo(() => templatePagesForEditor(pages), [pages]);
  const subpageMode = subpageSectionMode(childPages.length);
  const {
    draggedSubpageId,
    handleSubpagePointerDown,
    subpageDropTarget,
  } = useSubpageDrag({
    childPages,
    pageId: page.id,
    reorderPagesAction,
  });
  const editor = useMemo(
    () =>
      BlockNoteEditor.create({
        schema: openNotionEditorSchema,
        initialContent,
        dictionary: locale === "it" ? blockNoteLocaleIt : blockNoteLocaleEn,
        tabBehavior: "prefer-indent",
        uploadFile: async (file) => {
          return await uploadEditorMediaFile(file, page.id, showError);
        },
        pasteHandler: (args) => handleEditorPasteWithMedia(args, page.id, showError),
      }),
    // `locale` recreates the editor on language change. useEditorAutosave is
    // keyed on `editor`, so its cleanup serializes the old editor's pending
    // edits before the new instance takes over.
    [page.id, showError, locale]
  );
  const blockNoteTheme = appTheme === "dark" || (appTheme === "system" && systemDark) ? "dark" : "light";
  const {
    flushSaveNow,
    markSaveFailed,
    queueContentSave,
    queueSave,
    saveState,
  } = useEditorAutosave({
    pageId: page.id,
    editor,
    updatePageOptimistically,
  });
  const closePageMenu = useCallback(() => setPageMenuOpen(false), []);
  const pageActions = usePageActions({
    childPages,
    closePageMenu,
    deleteStudioDocumentAction,
    duplicatePageAction,
    movePageAction,
    onSelectPage,
    page,
    pages,
    queueSave,
    removePage,
    showError,
    showSuccess,
    studioDocuments,
    toggleFavoriteAction,
    toggleTemplateAction,
  });
  const {
    handleConfirmDelete,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
  } = pageActions;
  const {
    handleSubpageContextMenu,
    handleSubpageDelete,
    handleSubpageDuplicate,
    handleSubpageToggleFavorite,
    handleSubpageToggleTemplate,
    setSubpageActionsMenu,
    subpageActionsMenu,
    subpageContextMenu,
    subpageContextMenuRef,
  } = useSubpageActions({
    deleteStudioDocumentAction,
    duplicatePageAction,
    removePage,
    showError,
    showSuccess,
    studioDocuments,
    toggleFavoriteAction,
    toggleTemplateAction,
  });
  const isStudioVariant = variant === "studio";

  // Portal the BlockNote side menu into the editor root in Studio mode so
  // that it stays within the note panel's DOM tree. Combined with the wider
  // left padding (pl-12) in Studio mode, this keeps the drag handle / add
  // button fully visible without bleeding onto the PDF view.
  useEffect(() => {
    if (isStudioVariant && editorRootRef.current) {
      setSideMenuPortalEl(editorRootRef.current);
    }
  }, [isStudioVariant]);
  const slashMenuItems = useMemo(
    () => openNotionSlashMenuItems(editor, page.id, showError, showSuccess, t),
    // t changes only with locale; locale already recreates editor, so adding t
    // here does not introduce a new recreation trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, page.id, showError, showSuccess, t]
  );
  const pageLinkItems = useMemo(
    () => openNotionPageLinkItems(editor, pages, page.id, t),
    // t changes only with locale; locale already recreates editor, no new trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, page.id, pages, t]
  );
  const {
    handleMediaDragLeave,
    handleMediaDragOver,
    handleMediaDrop,
    isMediaDropActive,
  } = useEditorMediaDrop({
    editor,
    pageId: page.id,
    showError,
    showSuccess,
    t,
  });
  const slashMenuFloatingOptions = useMemo(
    () => ({
      useFloatingOptions: {
        strategy: "fixed" as const,
      },
      elementProps: {
        className: "on-slash-menu-popover",
      },
    }),
    []
  );
  const headingItems = useEditorState({
    editor,
    selector: ({ editor }) => headingItemsFromBlocks(editor.document as Block<any, any, any>[]),
    // Selection changes can't affect headings; skip the full-document walk on
    // every caret move.
    on: "change",
  }) ?? [];
  const { activeHeadingId, scrollToHeading } = useHeadingScrollSpy({ editor, scrollContainerRef, headingItems });

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);

    setSystemDark(query.matches);
    query.addEventListener("change", handleChange);

    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleOpenPageLink = (event: Event) => {
      const pageId = (event as CustomEvent<{ pageId?: string }>).detail?.pageId;
      if (!pageId) return;

      onSelectPage(pageId);
    };

    window.addEventListener(OPEN_PAGE_LINK_EVENT, handleOpenPageLink);
    return () => window.removeEventListener(OPEN_PAGE_LINK_EVENT, handleOpenPageLink);
  }, [onSelectPage]);

  useEffect(() => {
    setTitle(initialFields.title);
    setIcon(initialFields.icon);
    setCoverUrl(initialFields.coverUrl);
    setIsIconMenuOpen(false);
    setIsCoverInputOpen(false);
    setSubpageMenuOpen(false);
    setPageMenuOpen(false);
    setIsPageHistoryOpen(false);
  }, [page.id, initialFields.coverUrl, initialFields.icon, initialFields.title]);

  useEffect(() => {
    if (!isIconMenuOpen) return;

    requestAnimationFrame(() => {
      iconInputRef.current?.focus();
    });
  }, [isIconMenuOpen]);

  const handleTitleChange = (value: string) => {
    const nextTitle = value;
    setTitle(nextTitle);
    const savedTitle = nextTitle || "Untitled";
    queueSave({ title: savedTitle });
  };

  const resizeTitleInput = useCallback(() => {
    const element = titleInputRef.current;
    if (!element) return;

    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  const focusEditorBody = useCallback(() => {
    const firstBlock = editor.document[0];
    if (!firstBlock) return;

    const editable = editor.domElement?.querySelector<HTMLElement>("[contenteditable='true']");

    editable?.focus();
    editor.focus();
    editor.setTextCursorPosition(firstBlock, "end");
    requestAnimationFrame(() => {
      editable?.focus();
      editor.focus();
      editor.setTextCursorPosition(firstBlock, "end");
    });
  }, [editor]);

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;

    const insertsNewline = titleEnterShouldInsertNewline(titleEnterBehavior, event);
    titleEnterModifierRef.current = insertsNewline;

    if (insertsNewline) {
      event.preventDefault();
      const element = event.currentTarget;
      const selectionStart = element.selectionStart;
      const selectionEnd = element.selectionEnd;
      element.setRangeText("\n", selectionStart, selectionEnd, "end");
      handleTitleChange(element.value);
      resizeTitleInput();
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
    focusEditorBody();
  };

  const handleTitleBeforeInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    switch (titleBeforeInputAction(nativeEvent.inputType, titleEnterModifierRef.current)) {
      case "ignore":
        return;
      case "focus-body":
        event.preventDefault();
        event.currentTarget.blur();
        focusEditorBody();
        return;
      case "insert-newline":
        requestAnimationFrame(() => {
          handleTitleChange(event.currentTarget.value);
          resizeTitleInput();
          titleEnterModifierRef.current = false;
        });
        return;
    }
  };

  useEffect(() => {
    resizeTitleInput();
  }, [resizeTitleInput, title]);


  const isSlashMenuOpen = useSlashMenuScrollLock({ scrollContainerRef });
  const { handleEditorChange } = useEditorContentSync({
    editor,
    pageId: page.id,
    pages,
    queueContentSave,
    lastInteractionTypeRef,
    scrollContainerRef,
  });

  useEffect(() => {
    disableSpellcheck(editor.domElement ?? null);
    if (!editor.domElement) return undefined;

    const observer = new MutationObserver(() => disableSpellcheck(editor.domElement ?? null));
    observer.observe(editor.domElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);

  const handleIconChange = (value: string) => {
    const nextIcon = normalizePageIcon(value) || "";
    setIcon(nextIcon);
    queueSave({ icon: nextIcon || null });
  };

  const handleCoverUrlChange = (value: string) => {
    setCoverUrl(value);
    queueSave({ cover_url: normalizeCoverUrl(value) });
  };

  const handleRemoveCover = () => {
    setCoverUrl("");
    setIsCoverInputOpen(false);
    queueSave({ cover_url: null });
  };

  const handlePickCoverImage = async () => {
    try {
      const importedPath = await importCoverImageFromDialog(page.id);
      if (!importedPath) return;
      setCoverUrl(importedPath);
      setIsCoverInputOpen(false);
      queueSave({ cover_url: importedPath });
    } catch (error: unknown) {
      console.error("Failed to import cover image:", error);
      markSaveFailed(error);
    }
  };

  const handleRemoveIcon = () => {
    setIcon("");
    setIsIconMenuOpen(false);
    queueSave({ icon: null });
  };

  const handleOpenNativeIconPicker = () => {
    const input = iconInputRef.current;
    input?.focus();
    input?.setSelectionRange(0, input.value.length);
    void showCharacterPalette().catch((error: unknown) => {
      console.error("Failed to open character palette:", error);
    });
  };

  const handleCreateSubpage = async () => {
    const newPage = await addPage("Untitled", page.id);
    setSubpageMenuOpen(false);
    if (newPage) {
      onSelectPage(newPage.id);
    }
  };

  const handleCreateSubpageFromTemplate = async (templateId: string) => {
    const newPage = await addPageFromTemplate(templateId, page.id);
    setSubpageMenuOpen(false);
    if (newPage) {
      onSelectPage(newPage.id);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "a") {
      if (isNativeTextInput(event.target)) return;

      const target = event.target instanceof Node ? event.target : null;
      if (!target || !editor.domElement?.contains(target)) return;

      const firstBlock = editor.document[0];
      const lastBlock = editor.document[editor.document.length - 1];
      if (!firstBlock || !lastBlock) return;
      if (firstBlock.id === lastBlock.id) return;

      event.preventDefault();
      try {
        editor.setSelection(firstBlock, lastBlock);
      } catch {
        // setSelection cannot anchor in contentless blocks (formula, media).
        // Fall back to ProseMirror's AllSelection, which handles leaf blocks.
        (editor as unknown as { _tiptapEditor?: { commands: { selectAll: () => void } } })
          ._tiptapEditor?.commands.selectAll();
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSaveNow();
    }
  };

  return (
    <div
      ref={editorRootRef}
      className="flex flex-col h-full w-full relative"
      onKeyDown={handleKeyDown}
      onKeyDownCapture={() => { lastInteractionTypeRef.current = "keyboard"; }}
      onPointerDownCapture={() => { lastInteractionTypeRef.current = "pointer"; }}
    >
      {!isStudioVariant && (
        <PageEditorTopBar
          page={page}
          inSplit={inSplit}
          breadcrumbs={breadcrumbs}
          saveState={saveState}
          flushSaveNow={flushSaveNow}
          onSelectPage={onSelectPage}
          pageMenuOpen={pageMenuOpen}
          setPageMenuOpen={setPageMenuOpen}
          pageMenuButtonRef={pageMenuButtonRef}
          isSplitMenuOpen={isSplitMenuOpen}
          setIsSplitMenuOpen={setIsSplitMenuOpen}
          splitButtonRef={splitButtonRef}
          setIsPageHistoryOpen={setIsPageHistoryOpen}
          pageActions={pageActions}
        />
      )}
      {!isStudioVariant && (
        <PageHeadingRail
          items={headingItems}
          activeId={activeHeadingId}
          onSelect={scrollToHeading}
        />
      )}
      <div
        ref={scrollContainerRef}
        className={`on-scroll-fade on-page-editor-scroll flex-1 w-full overflow-y-auto${isSlashMenuOpen ? " on-editor-scroll-locked" : ""}`}
      >
        <div className={`relative ${pageWidth === "full" ? "max-w-none" : "max-w-3xl"} ${isStudioVariant ? "pl-12 pr-8" : "px-8"} pt-8 mx-auto flex min-h-full w-full flex-col pb-16 on-editor-typography on-editor-font-${editorFont} on-editor-size-${editorFontSize}`}>
          {isStudioVariant && (
            // Overlaid in the right gutter so it never pushes the title down.
            <button
              type="button"
              className="absolute right-1 top-9 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("editor.versionHistory")}
              aria-label={t("editor.versionHistory")}
              onClick={() => setIsPageHistoryOpen(true)}
            >
              <History className="h-4 w-4" />
            </button>
          )}
          {!isStudioVariant && (
            <div className="group/page-actions mb-3 flex min-h-7 items-center gap-3 text-xs text-muted-foreground">
              <div className="flex min-w-0 flex-1 items-center gap-2 opacity-0 transition-opacity group-hover/page-actions:opacity-100 focus-within:opacity-100">
                {!icon && (
                  <button
                    ref={iconMenuButtonRef}
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                    onClick={() => setIsIconMenuOpen((open) => !open)}
                  >
                    <Smile className="h-3.5 w-3.5" />
                    {t("editor.addIcon")}
                  </button>
                )}
                {!coverUrl && !isCoverInputOpen && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                    onClick={() => void handlePickCoverImage()}
                  >
                    <Image className="h-3.5 w-3.5" />
                    {t("editor.addCover")}
                  </button>
                )}
                {coverUrl && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                    onClick={() => void handlePickCoverImage()}
                  >
                    <Image className="h-3.5 w-3.5" />
                    {t("editor.changeCover")}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                  onClick={() => setIsCoverInputOpen((open) => !open)}
                >
                  {t("editor.coverUrl")}
                </button>
                {isCoverInputOpen && (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                    <Image className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                    <input
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                      value={coverUrl}
                      placeholder={t("editor.coverUrlPlaceholder")}
                      aria-label={t("editor.coverUrlAriaLabel")}
                      onChange={(event) => handleCoverUrlChange(event.target.value)}
                      autoFocus
                    />
                    {coverUrl && (
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-muted"
                        aria-label={t("editor.removeCover")}
                        onClick={handleRemoveCover}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {isCoverInputOpen && (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                    onClick={() => void handlePickCoverImage()}
                  >
                    {t("editor.chooseFile")}
                  </button>
                )}
              </div>
            </div>
          )}
        {!isStudioVariant && coverUrl && (
          <div className="group relative mb-8 h-44 w-full overflow-hidden rounded-md bg-muted">
            <div
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${coverImageSrc(coverUrl)})` }}
              aria-hidden="true"
            />
            <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
                onClick={() => void handlePickCoverImage()}
              >
                {t("editor.changeCover")}
              </button>
              <button
                type="button"
                className="rounded-md bg-background/85 p-1 text-muted-foreground shadow-sm hover:text-foreground"
                aria-label={t("editor.removeCover")}
                onClick={handleRemoveCover}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {!isStudioVariant && (
        <div className="relative">
          {icon && (
            <button
              ref={iconMenuButtonRef}
              type="button"
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-md text-5xl hover:bg-muted"
              aria-label={t("editor.changePageIcon")}
              onClick={() => setIsIconMenuOpen((open) => !open)}
            >
              {icon}
            </button>
          )}
          {isIconMenuOpen && (
            <FloatingPopover
              anchorElement={iconMenuButtonRef.current}
              open={isIconMenuOpen}
              width={256}
              onOpenChange={setIsIconMenuOpen}
              className="on-popover p-2"
            >
              <button
                type="button"
                className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleOpenNativeIconPicker}
              >
                <Smile className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.openNativePicker")}
              </button>
              <div className="grid grid-cols-6 gap-1">
                {ICON_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted"
                    onClick={() => {
                      handleIconChange(option);
                      setIsIconMenuOpen(false);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
                <Smile className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <input
                  ref={iconInputRef}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  value={icon}
                  placeholder={t("editor.customIconPlaceholder")}
                  aria-label={t("editor.customIconAriaLabel")}
                  onChange={(event) => handleIconChange(event.target.value)}
                  autoFocus
                />
                {icon && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("editor.removeIcon")}
                    onClick={handleRemoveIcon}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </FloatingPopover>
          )}
        </div>
        )}
        <div className="mb-4 flex items-start gap-4">
          <textarea
            ref={titleInputRef}
            className="on-page-title-input text-4xl min-h-[1.15em] min-w-0 flex-1 resize-none overflow-hidden bg-transparent font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground"
            value={title}
            placeholder={t("editor.titlePlaceholder")}
            rows={1}
            spellCheck={false}
            onChange={(event) => handleTitleChange(event.target.value)}
            onInput={resizeTitleInput}
            onBeforeInput={handleTitleBeforeInput}
            onKeyDown={handleTitleKeyDown}
          />
          {!isStudioVariant && subpageMode !== "list" && (
            <div className="relative mt-2 shrink-0">
              <button
                ref={subpageMenuButtonRef}
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setSubpageMenuOpen((open) => !open)}
              >
                <PlusCircle className="h-4 w-4" />
                <span>{t("editor.addSubpage")}</span>
              </button>
              <SubpageCreateMenu
                anchorElement={subpageMenuButtonRef.current}
                open={subpageMenuOpen}
                align="end"
                templatePages={templatePages}
                onOpenChange={setSubpageMenuOpen}
                onCreateBlank={() => void handleCreateSubpage()}
                onCreateFromTemplate={(templateId) => void handleCreateSubpageFromTemplate(templateId)}
              />
            </div>
          )}
        </div>
        {!isStudioVariant && page.is_template === 1 && (
          <div className="mb-6 inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <Copy className="h-3.5 w-3.5" />
            {t("editor.template")}
          </div>
        )}
        {!isStudioVariant && databaseParentPage && (
          <DatabaseRowPropertiesPanel databasePage={databaseParentPage} rowPage={page} />
        )}
        {!isStudioVariant && page.is_database === 1 ? (
          <DatabaseTableView databasePage={page} rows={childPages} onSelectPage={onSelectPage} />
        ) : !isStudioVariant && subpageMode === "list" ? (
          <div className="mb-8 space-y-1">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("editor.subpages")}</div>
              <div className="relative">
                <button
                  ref={subpageMenuButtonRef}
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setSubpageMenuOpen((open) => !open)}
                >
                  {t("editor.newSubpage")}
                </button>
                <SubpageCreateMenu
                  anchorElement={subpageMenuButtonRef.current}
                  open={subpageMenuOpen}
                  align="end"
                  templatePages={templatePages}
                  onOpenChange={setSubpageMenuOpen}
                  onCreateBlank={() => void handleCreateSubpage()}
                  onCreateFromTemplate={(templateId) => void handleCreateSubpageFromTemplate(templateId)}
                />
              </div>
            </div>
            {childPages.map((childPage) => {
              const childTitle = childPage.title || t("sidebar.untitled");
              const dropClass = subpageDropTarget?.pageId === childPage.id
                ? subpageDropTarget.position === "before"
                  ? "on-subpage-drop-before"
                  : "on-subpage-drop-after"
                : "";

              const isActionsMenuOpen = subpageActionsMenu?.page.id === childPage.id;

              return (
                <div
                  key={childPage.id}
                  data-subpage-row-id={childPage.id}
                  className={`group relative flex w-full items-center rounded-md border-y-2 border-y-transparent text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground ${dropClass} ${draggedSubpageId === childPage.id ? "opacity-45" : ""}`}
                  onContextMenu={(event) => handleSubpageContextMenu(event, childPage)}
                >
                  <button
                    type="button"
                    data-subpage-drag-handle=""
                    aria-label={t("editor.reorderSubpage", { title: childTitle })}
                    className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onPointerDown={(event) => handleSubpagePointerDown(event, childPage.id)}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left"
                    onClick={() => onSelectPage(childPage.id)}
                  >
                    {childPage.icon ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{childPage.icon}</span>
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{childTitle}</span>
                  </button>
                  <button
                    type="button"
                    className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 ${
                      isActionsMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setSubpageActionsMenu({
                        page: childPage,
                        anchorElement: e.currentTarget,
                      });
                    }}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {subpageActionsMenu && (
              <FloatingPopover
                anchorElement={subpageActionsMenu.anchorElement}
                open={true}
                width={180}
                placement="bottom-end"
                onOpenChange={(open) => {
                  if (!open) setSubpageActionsMenu(null);
                }}
                className="on-popover on-page-action-popover"
              >
                <SubpageActionsMenu
                  page={subpageActionsMenu.page}
                  onDuplicate={(childPage) => void handleSubpageDuplicate(childPage)}
                  onToggleFavorite={(childPage) => void handleSubpageToggleFavorite(childPage)}
                  onToggleTemplate={(childPage) => void handleSubpageToggleTemplate(childPage)}
                  onDelete={(childPage) => void handleSubpageDelete(childPage)}
                />
              </FloatingPopover>
            )}
            {subpageContextMenu && createPortal(
              <div
                ref={subpageContextMenuRef}
                className="fixed z-[180] w-48 on-popover on-page-action-popover"
                style={{
                  left: subpageContextMenu.left,
                  top: subpageContextMenu.top,
                  maxHeight: Math.max(96, window.innerHeight - subpageContextMenu.top - 12),
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <SubpageActionsMenu
                  page={subpageContextMenu.page}
                  onDuplicate={(childPage) => void handleSubpageDuplicate(childPage)}
                  onToggleFavorite={(childPage) => void handleSubpageToggleFavorite(childPage)}
                  onToggleTemplate={(childPage) => void handleSubpageToggleTemplate(childPage)}
                  onDelete={(childPage) => void handleSubpageDelete(childPage)}
                />
              </div>,
              document.body
            )}
          </div>
        ) : null}
        <div
          className="on-page-editor-blocks relative -ml-10 flex-1 overflow-visible bg-transparent pl-10"
          data-editor-media-drop={isMediaDropActive ? "active" : undefined}
          onDragEnter={handleMediaDragOver}
          onDragOver={handleMediaDragOver}
          onDragLeave={handleMediaDragLeave}
          onDrop={handleMediaDrop}
        >
          <BlockNoteView
            editor={editor}
            theme={blockNoteTheme}
            formattingToolbar={false}
            slashMenu={false}
            sideMenu={false}
            onChange={handleEditorChange}
          >
            {/* Floating UI portals into the editor's own bn-container by
                default. Do not pass `null` as a portal target: since
                BlockNote 0.56 that mounts into a detached node (invisible). */}
            <FormattingToolbarController formattingToolbar={ShelfFormattingToolbar} />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={slashMenuItems}
              floatingUIOptions={slashMenuFloatingOptions}
            />
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={pageLinkItems}
              floatingUIOptions={slashMenuFloatingOptions}
            />
            <SideMenuController
              sideMenu={ShelfSideMenu}
              portalElement={isStudioVariant ? (sideMenuPortalEl ?? undefined) : undefined}
            />
          </BlockNoteView>
        </div>
      </div>
      </div>
      {isDeleteConfirmOpen && (
        <div className="on-modal-overlay z-[150] items-center justify-center" onMouseDown={() => setIsDeleteConfirmOpen(false)}>
          <div className="on-modal-panel on-delete-dialog w-[420px]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="on-delete-dialog-content">
              <div className="on-delete-dialog-icon">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t("editor.deleteDialog.title")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {childPages.length > 0
                    ? t("editor.deleteDialog.bodyWithChildren", { title: title || t("sidebar.untitled") })
                    : t("editor.deleteDialog.body", { title: title || t("sidebar.untitled") })}
                </div>
              </div>
            </div>
            <div className="on-delete-dialog-actions">
              <button
                type="button"
                className="on-button-secondary"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="on-button-danger"
                onClick={() => void handleConfirmDelete()}
              >
                {t("sidebar.contextDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
      <PageHistoryDialog
        pageId={page.id}
        open={isPageHistoryOpen}
        onClose={() => setIsPageHistoryOpen(false)}
        onBeforeRestore={flushSaveNow}
      />
    </div>
  );
}
