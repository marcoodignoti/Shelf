import { Block, BlockNoteEditor, editorHasBlockWithType } from "@blocknote/core";
import { en as blockNoteLocaleEn, it as blockNoteLocaleIt } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";
import {
  AddBlockButton,
  blockTypeSelectItems,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useEditorState,
  useExtensionState,
} from "@blocknote/react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Download, FileText, FolderInput, GripVertical, Image, MoreHorizontal, PlusCircle, Sigma, Smile, Star, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseRowPropertiesPanel, DatabaseTableView } from "./DatabaseTableView";
import { blockDropTargetFromPoint, BlockDropTarget, clearBlockDropIndicator, moveEditorBlock } from "../lib/editorBlockDrag";
import {
  activeElementIsNativeTextInput,
  blockElementSelector,
  disableSpellcheck,
  headingItemsFromBlocks,
  HeadingRailItem,
  isNativeTextInput,
  keepEditorCaretInView,
  preserveEditorScroll,
} from "../lib/editorDom";
import { pageBreadcrumb } from "../lib/breadcrumb";
import { showCharacterPalette } from "../lib/desktop";
import { coverImageSrc, getPage, importCoverImageFromDialog, Page } from "../lib/db";
import { databaseParentPageForEditor, templatePagesForEditor } from "../lib/editorPageCollections";
import { saveStatusLabel } from "../lib/editorSaveState";
import { useLocale, useT } from "../lib/i18n";
import { OPEN_PAGE_LINK_EVENT, syncPageLinkInlineContentInEditor } from "../lib/editorLinks";
import { formulaInputFromBlockContent, normalizeMathInlineContentInEditor, openNotionEditorSchema } from "../lib/editorMath";
import { parsePageBlocks } from "../lib/pageContent";
import { normalizeCoverUrl, normalizePageIcon } from "../lib/pageMetadata";
import { titleEnterShouldInsertNewline } from "../lib/editorTitleInput";
import { childPagesForParent } from "../lib/pageTree";
import { subpageSectionMode } from "../lib/subpageSection";
import {
  eventPathIncludesSelector,
  openNotionPageLinkItems,
  openNotionSlashMenuItems,
  slashMenuElement,
} from "../lib/editorSlashMenu";
import { useAppStore } from "../store/useAppStore";
import { useUIStore } from "../store/useUIStore";
import { FloatingPopover } from "./FloatingPopover";
import { SubpageActionsMenu } from "./SubpageActionsMenu";
import { useEditorAutosave } from "./useEditorAutosave";
import { handleEditorPasteWithMedia, uploadEditorMediaFile, useEditorMediaDrop } from "./useEditorMediaImport";
import { usePageActions } from "./usePageActions";
import { useSubpageActions } from "./useSubpageActions";
import { useSubpageDrag } from "./useSubpageDrag";

const ICON_OPTIONS = ["📄", "✅", "💡", "📌", "🚀", "🧠", "🛠️", "📚", "🎯", "✨", "🔥", "📝"];

function ShelfSideMenu() {
  return (
    <SideMenu>
      <AddBlockButton />
      <ShelfDragHandleButton />
    </SideMenu>
  );
}

function PageHeadingRail({
  items,
  activeId,
  onSelect,
}: {
  items: HeadingRailItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const previousItem = items[Math.max(0, activeIndex - 1)] ?? null;
  const nextItem = items[Math.min(items.length - 1, activeIndex + 1)] ?? null;

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("editor.pageSections")}
      className="group/rail absolute bottom-16 right-3 top-20 z-[70] hidden w-14 flex-col items-center justify-center overflow-visible xl:flex"
    >
      <div className="flex h-full max-h-[34rem] flex-col items-center justify-between gap-2 rounded-full py-1 text-muted-foreground/70 opacity-45 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className="on-heading-rail-arrow"
          aria-label={t("editor.previousSection")}
          disabled={!previousItem || previousItem.id === activeId}
          onClick={() => previousItem && onSelect(previousItem.id)}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-visible py-1">
          {items.map((item) => {
            const isActive = item.id === activeId;
            const tickWidth = item.level <= 1 ? "w-8" : item.level === 2 ? "w-6" : "w-4";

            return (
              <button
                key={item.id}
                type="button"
                className="group/railitem relative flex h-3 w-10 items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={t("editor.goToSection", { title: item.title || t("editor.untitledSection") })}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span
                  className={`${tickWidth} h-px rounded-full transition-all ${isActive ? "h-0.5 bg-foreground" : "bg-muted-foreground/70 group-hover/railitem:bg-foreground"}`}
                />
                <span className={`on-heading-rail-preview pointer-events-none absolute right-12 top-1/2 z-10 max-w-80 -translate-y-1/2 translate-x-1 truncate px-4 py-2 text-sm font-semibold leading-tight text-popover-foreground opacity-0 transition-all duration-150 group-hover/railitem:pointer-events-auto group-hover/railitem:translate-x-0 group-hover/railitem:opacity-100 group-hover/railitem:text-foreground group-focus-visible/railitem:pointer-events-auto group-focus-visible/railitem:translate-x-0 group-focus-visible/railitem:opacity-100 ${isActive ? "text-foreground" : ""}`}>
                  {item.title || t("editor.untitledSection")}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="on-heading-rail-arrow"
          aria-label={t("editor.nextSection")}
          disabled={!nextItem || nextItem.id === activeId}
          onClick={() => nextItem && onSelect(nextItem.id)}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

function ShelfDragHandleButton() {
  const t = useT();
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!block || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const sourceId = block.id;
    let dropTarget: BlockDropTarget | null = null;

    event.currentTarget.setPointerCapture(pointerId);
    document.body.classList.add("opennotion-block-dragging");

    const updateTarget = (clientX: number, clientY: number) => {
      clearBlockDropIndicator();
      dropTarget = blockDropTargetFromPoint(editor, clientX, clientY, sourceId);

      if (dropTarget) {
        dropTarget.element.dataset.opennotionBlockDrop = dropTarget.placement;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientX, moveEvent.clientY);
    };

    function finishDrag() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      clearBlockDropIndicator();
      document.body.classList.remove("opennotion-block-dragging");
    }

    function handlePointerUp() {
      finishDrag();

      if (dropTarget) {
        moveEditorBlock(editor, sourceId, dropTarget.blockId, dropTarget.placement);
      }
    }

    function handlePointerCancel() {
      finishDrag();
    }

    updateTarget(event.clientX, event.clientY);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  };

  if (!block) {
    return null;
  }

  return (
    <button
      type="button"
      className="bn-button opennotion-block-drag-handle"
      aria-label={t("editor.dragBlock")}
      onPointerDown={handlePointerDown}
    >
      <GripVertical className="h-5 w-5" />
    </button>
  );
}

function ShelfBlockTypeSelect() {
  const t = useT();
  const editor = useBlockNoteEditor<any, any, any>();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedBlocks = useEditorState({
    editor,
    selector: ({ editor }) => editor.getSelection()?.blocks || [editor.getTextCursorPosition().block],
  });
  const firstSelectedBlock = selectedBlocks[0];

  const items = useMemo(
    () => [
      ...blockTypeSelectItems(editor.dictionary),
      {
        name: "Formula",
        type: "formula",
        icon: Sigma,
      },
    ],
    [editor]
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        editorHasBlockWithType(
          editor,
          item.type,
          Object.fromEntries(
            Object.entries(item.props || {}).map(([propName, propValue]) => [
              propName,
              typeof propValue,
            ])
          ) as Record<string, "string" | "number" | "boolean">
        )
      ),
    [editor, items]
  );

  const selectItems = useMemo(
    () =>
      filteredItems.map((item) => {
        const Icon = item.icon;
        const typesMatch = item.type === firstSelectedBlock.type;
        const propsMatch =
          Object.entries(item.props || {}).filter(
            ([propName, propValue]) => propValue !== firstSelectedBlock.props[propName]
          ).length === 0;

        return {
          text: item.name,
          icon: <Icon size={16} />,
          isSelected: typesMatch && propsMatch,
          onClick: () => {
            const restoreScroll = preserveEditorScroll(editor);
            editor.transact(() => {
              for (const block of selectedBlocks) {
                if (item.type === "formula") {
                  editor.updateBlock(block, {
                    type: "formula",
                    props: {
                      formula: formulaInputFromBlockContent(block.content) || block.props.formula || "\\nabla \\cdot \\vec{E}",
                    },
                    content: undefined,
                  } as never);
                } else {
                  editor.updateBlock(block, {
                    type: item.type as never,
                    props: item.props as never,
                  });
                }
              }
            });
            restoreScroll();
          },
        };
      }),
    [editor, filteredItems, firstSelectedBlock.props, firstSelectedBlock.type, selectedBlocks]
  );

  const selectedItem = selectItems.find((item) => item.isSelected) ?? null;
  const selectedIndex = Math.max(0, selectItems.findIndex((item) => item.isSelected));

  useEffect(() => {
    if (!isOpen) return;

    activeIndexRef.current = selectedIndex;
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => {
      menuItemRefs.current[selectedIndex]?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, selectedIndex]);

  const chooseItem = useCallback(
    (index: number) => {
      const item = selectItems[index];
      if (!item) return;

      item.onClick();
      setIsOpen(false);
      buttonRef.current?.focus();
    },
    [selectItems]
  );

  const openMenuAt = useCallback(
    (index: number) => {
      const lastIndex = selectItems.length - 1;
      const clampedIndex = Math.max(0, Math.min(index, lastIndex));

      activeIndexRef.current = clampedIndex;
      setActiveIndex(clampedIndex);
      setIsOpen(true);
    },
    [selectItems.length]
  );

  const moveActiveItem = useCallback(
    (nextIndex: number) => {
      const lastIndex = selectItems.length - 1;
      const clampedIndex = Math.max(0, Math.min(nextIndex, lastIndex));

      activeIndexRef.current = clampedIndex;
      setActiveIndex(clampedIndex);
      menuItemRefs.current[clampedIndex]?.focus();
    },
    [selectItems.length]
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = activeIndexRef.current;
        moveActiveItem(currentIndex >= selectItems.length - 1 ? 0 : currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = activeIndexRef.current;
        moveActiveItem(currentIndex <= 0 ? selectItems.length - 1 : currentIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveActiveItem(0);
      } else if (event.key === "End") {
        event.preventDefault();
        moveActiveItem(selectItems.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseItem(activeIndexRef.current);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    },
    [chooseItem, moveActiveItem, selectItems.length]
  );

  if (!selectedItem || !editor.isEditable) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="opennotion-block-type-select"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.currentTarget.focus();
          setIsOpen((open) => !open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenuAt(isOpen ? activeIndexRef.current + 1 : selectedIndex);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenuAt(isOpen ? activeIndexRef.current - 1 : selectItems.length - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            openMenuAt(0);
          } else if (event.key === "End") {
            event.preventDefault();
            openMenuAt(selectItems.length - 1);
          } else if (isOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            chooseItem(activeIndexRef.current);
          } else if (isOpen && event.key === "Escape") {
            event.preventDefault();
            setIsOpen(false);
          }
        }}
      >
        {selectedItem.icon}
        <span className="truncate">{selectedItem.text}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <FloatingPopover
        anchorElement={buttonRef.current}
        open={isOpen}
        onOpenChange={setIsOpen}
        placement="bottom-start"
        width={230}
        zIndex={240}
        className="on-popover opennotion-block-type-menu"
      >
        <div role="menu" aria-label={t("editor.blockType")} className="grid gap-0.5" onKeyDown={handleMenuKeyDown}>
          {selectItems.map((item, index) => (
            <button
              key={`${item.text}-${item.isSelected ? "selected" : "available"}`}
              ref={(element) => {
                menuItemRefs.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={item.isSelected}
              tabIndex={index === activeIndex ? 0 : -1}
              className="opennotion-block-type-menu-item"
              data-active={index === activeIndex ? "true" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                chooseItem(index);
              }}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate text-left">{item.text}</span>
              {item.isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
            </button>
          ))}
        </div>
      </FloatingPopover>
    </>
  );
}

function ShelfFormattingToolbar() {
  return (
    <FormattingToolbar>
      <ShelfBlockTypeSelect />
      {getFormattingToolbarItems([]).slice(1)}
    </FormattingToolbar>
  );
}

function SubpageCreateMenu({
  anchorElement,
  open,
  align,
  templatePages,
  onCreateBlank,
  onCreateFromTemplate,
  onOpenChange,
}: {
  anchorElement: HTMLElement | null;
  open: boolean;
  align: "start" | "end";
  templatePages: Page[];
  onCreateBlank: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <FloatingPopover
      anchorElement={anchorElement}
      open={open}
      width={224}
      placement={align === "end" ? "bottom-end" : "bottom-start"}
      onOpenChange={onOpenChange}
      className="on-popover"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
        onClick={onCreateBlank}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        {t("sidebar.blankPage")}
      </button>
      {templatePages.length > 0 && <div className="my-1 h-px bg-border" />}
      {templatePages.map((template) => (
        <button
          key={`subpage-template-${template.id}`}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => onCreateFromTemplate(template.id)}
        >
          {template.icon ? (
            <span className="flex h-3.5 w-3.5 items-center justify-center text-xs">{template.icon}</span>
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="truncate">{template.title || t("sidebar.untitled")}</span>
        </button>
      ))}
    </FloatingPopover>
  );
}

export function Editor(props: {
  page: Page;
  pages: Page[];
  onSelectPage: (id: string) => void;
  variant?: "page" | "studio";
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

  return <EditorSurface {...props} />;
}

function EditorSurface({
  page,
  pages,
  onSelectPage,
  variant = "page",
}: {
  page: Page;
  pages: Page[];
  onSelectPage: (id: string) => void;
  variant?: "page" | "studio";
}) {
  const isNormalizingMathRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const slashMenuLockedScrollTopRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const titleEnterModifierRef = useRef(false);
  const iconMenuButtonRef = useRef<HTMLButtonElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const pageMenuButtonRef = useRef<HTMLButtonElement>(null);
  const subpageMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState(page.title || "");
  const [icon, setIcon] = useState(page.icon || "");
  const [coverUrl, setCoverUrl] = useState(page.cover_url || "");
  const [isIconMenuOpen, setIsIconMenuOpen] = useState(false);
  const [isCoverInputOpen, setIsCoverInputOpen] = useState(false);
  const [subpageMenuOpen, setSubpageMenuOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
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
  const initialContent = useMemo(() => parsePageBlocks(page.content), [page.id, locale]);
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
  const {
    handleConfirmDelete,
    handleDuplicatePage,
    handleExportJSON,
    handleExportMarkdown,
    handleMovePage,
    handleOpenMoveMenu,
    handleRequestDelete,
    handleToggleFavorite,
    handleToggleTemplate,
    handleTurnIntoDatabase,
    isDeleteConfirmOpen,
    movablePages,
    moveMenuOpen,
    moveQuery,
    setIsDeleteConfirmOpen,
    setMoveMenuOpen,
    setMoveQuery,
  } = usePageActions({
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
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(headingItems[0]?.id ?? null);
  const pendingHeadingScrollRef = useRef<{ id: string; clearTimer: number } | null>(null);

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
    setTitle(page.title || "");
    setIcon(page.icon || "");
    setCoverUrl(page.cover_url || "");
    setIsIconMenuOpen(false);
    setIsCoverInputOpen(false);
    setSubpageMenuOpen(false);
    setPageMenuOpen(false);
  }, [page.id]);

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
    if (nativeEvent.inputType !== "insertLineBreak") return;

    if (!titleEnterModifierRef.current) {
      event.preventDefault();
      event.currentTarget.blur();
      focusEditorBody();
      return;
    }

    requestAnimationFrame(() => {
      handleTitleChange(event.currentTarget.value);
      resizeTitleInput();
      titleEnterModifierRef.current = false;
    });
  };

  useEffect(() => {
    resizeTitleInput();
  }, [resizeTitleInput, title]);

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
  }, [editor]);

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
      let current = headingItems[0]?.id ?? null;

      for (const item of headingItems) {
        const element = editor.domElement?.querySelector<HTMLElement>(blockElementSelector(item.id));
        if (!element) continue;

        if (element.getBoundingClientRect().top <= containerTop + 140) {
          current = item.id;
        } else {
          break;
        }
      }

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
  }, [editor, headingItems]);

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
  }, []);

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
  }, []);

  const handleEditorChange = () => {
    if (!isNormalizingMathRef.current) {
      isNormalizingMathRef.current = true;
      const normalized = normalizeMathInlineContentInEditor(editor);
      isNormalizingMathRef.current = false;

      if (normalized) return;
    }

    queueContentSave();
    if (activeElementIsNativeTextInput()) return;
    keepEditorCaretInView(editor, scrollContainerRef.current);
  };

  useEffect(() => {
    disableSpellcheck(editor.domElement ?? null);
    if (!editor.domElement) return undefined;

    const observer = new MutationObserver(() => disableSpellcheck(editor.domElement ?? null));
    observer.observe(editor.domElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);

  useEffect(() => {
    isNormalizingMathRef.current = true;
    const normalized = normalizeMathInlineContentInEditor(editor);
    isNormalizingMathRef.current = false;

    if (!normalized) return;

    queueContentSave();
  }, [editor, page.id, queueContentSave]);

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
    <div className="flex flex-col h-full w-full relative" onKeyDown={handleKeyDown}>
      {!isStudioVariant && (
        <div className="on-win-titlebar h-11 border border-b-0 border-border/70 rounded-t-xl flex items-center justify-between pr-6 pl-[var(--on-main-titlebar-content-left)] shrink-0 bg-background/95 backdrop-blur z-40 select-none">
          {/* Breadcrumbs on the left */}
          <nav className="flex items-center gap-1 min-w-0" aria-label={t("editor.pageBreadcrumb")}>
            {breadcrumbs.map((breadcrumb, index) => {
              const isCurrent = breadcrumb.id === page.id;
              return (
                <div key={breadcrumb.id} className="flex items-center min-w-0">
                  {index > 0 && <span className="mx-1 text-muted-foreground/45 text-[11px]">/</span>}
                  <button
                    type="button"
                    title={breadcrumb.title || t("sidebar.untitled")}
                    className={`px-1.5 py-1 rounded-md text-[13px] font-medium transition-colors hover:bg-muted text-muted-foreground truncate ${
                      isCurrent
                        ? "text-foreground font-semibold cursor-default pointer-events-none max-w-[240px] md:max-w-[320px]"
                        : "max-w-[140px] md:max-w-[180px]"
                    }`}
                    disabled={isCurrent}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => onSelectPage(breadcrumb.id)}
                  >
                    {breadcrumb.icon ? `${breadcrumb.icon} ` : ""}
                    {breadcrumb.title || t("sidebar.untitled")}
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Saved Status and Actions on the right */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              className={`text-xs text-muted-foreground/60 transition-colors ${saveState.status === "error" ? "text-destructive" : ""}`}
              title={saveState.status === "error" ? saveState.message : t("editor.saveStatus")}
            >
              {saveStatusLabel(saveState, t)}
            </div>
            <button
              type="button"
              ref={pageMenuButtonRef}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("editor.pageActions")}
              onClick={() => setPageMenuOpen((open) => !open)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <FloatingPopover
              anchorElement={pageMenuButtonRef.current}
              open={pageMenuOpen}
              width={224}
              placement="bottom-end"
              onOpenChange={setPageMenuOpen}
              className="on-popover on-page-action-popover"
            >
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleDuplicatePage()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.duplicate")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={handleOpenMoveMenu}
              >
                <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
                {t("sidebar.moveTo")}
              </button>
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleExportMarkdown()}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.exportMarkdown")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleExportJSON()}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.exportJSON")}
              </button>
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleToggleFavorite()}
              >
                <Star className={`h-3.5 w-3.5 text-muted-foreground ${page.is_favorite === 1 ? "fill-current" : ""}`} />
                {page.is_favorite === 1 ? t("sidebar.contextRemoveFromFavorites") : t("sidebar.contextAddToFavorites")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleToggleTemplate()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {page.is_template === 1 ? t("sidebar.contextRemoveFromTemplates") : t("sidebar.contextUseAsTemplate")}
              </button>
              {page.is_database !== 1 && (
                <button
                  type="button"
                  className="on-menu-item"
                  onClick={handleTurnIntoDatabase}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("editor.turnIntoDatabase")}
                </button>
              )}
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item on-menu-item-danger"
                onClick={handleRequestDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("sidebar.contextDelete")}
              </button>
            </FloatingPopover>
            <FloatingPopover
              anchorElement={pageMenuButtonRef.current}
              open={moveMenuOpen}
              width={288}
              placement="bottom-end"
              onOpenChange={setMoveMenuOpen}
              className="on-popover"
            >
              <div className="on-popover-search">
                <input
                  className="w-full rounded-full bg-background/60 px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder={t("sidebar.moveTo")}
                  value={moveQuery}
                  onChange={(event) => setMoveQuery(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                <button
                  type="button"
                  className="on-menu-item justify-between"
                  onClick={() => void handleMovePage(null)}
                >
                  <span className="truncate text-muted-foreground">{t("sidebar.moveRoot")}</span>
                  {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {movablePages.map((target) => (
                  <button
                    type="button"
                    key={target.id}
                    className="on-menu-item justify-between"
                    onClick={() => void handleMovePage(target.id)}
                  >
                    <span className="truncate">
                      {target.icon ? `${target.icon} ` : ""}
                      {target.title || t("sidebar.untitled")}
                    </span>
                    {page.parent_id === target.id && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                ))}
                {movablePages.length === 0 && moveQuery.trim() && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">{t("sidebar.noPagesFound")}</div>
                )}
              </div>
            </FloatingPopover>
          </div>
        </div>
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
        <div className={`${pageWidth === "full" ? "max-w-none" : "max-w-3xl"} px-8 pt-8 mx-auto flex min-h-full w-full flex-col pb-16 on-editor-typography on-editor-font-${editorFont} on-editor-size-${editorFontSize}`}>
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
                className="on-popover on-page-action-popover p-1"
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
                className="fixed z-[180] w-48 on-popover on-page-action-popover p-1"
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
            portalElements={{ default: null }}
            onChange={handleEditorChange}
          >
            <FormattingToolbarController formattingToolbar={ShelfFormattingToolbar} />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={slashMenuItems}
              portalElement={null}
              floatingUIOptions={slashMenuFloatingOptions}
            />
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={pageLinkItems}
              portalElement={null}
              floatingUIOptions={slashMenuFloatingOptions}
            />
            <SideMenuController sideMenu={ShelfSideMenu} />
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
    </div>
  );
}
