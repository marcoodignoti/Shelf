import { Block, BlockNoteEditor, editorHasBlockWithType } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { filterSuggestionItems, SideMenuExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";
import {
  AddBlockButton,
  blockTypeSelectItems,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  getDefaultReactSlashMenuItems,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useComponentsContext,
  useBlockNoteEditor,
  useEditorState,
  useExtensionState,
} from "@blocknote/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, Copy, FileText, FolderInput, GripVertical, Image, MoreHorizontal, PlusCircle, Sigma, Smile, Star, Trash2, X } from "lucide-react";
import { RiFormula } from "react-icons/ri";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DatabaseRowPropertiesPanel, DatabaseTableView } from "./DatabaseTableView";
import { blockDropPlacementFromOffset, BlockDropPlacement } from "../lib/blockDrag";
import { pageBreadcrumb } from "../lib/breadcrumb";
import { defaultDatabaseSchema } from "../lib/database";
import { coverImageSrc, importCoverImage, importEditorImage, updatePage, Page } from "../lib/db";
import { editorSaveReducer, errorMessage, saveStatusLabel } from "../lib/editorSaveState";
import { blocksFromPastedMathText, formulaInputFromBlockContent, formulaSlashMenuItem, normalizeMathInlineContentInEditor, openNotionEditorSchema } from "../lib/editorMath";
import { pageContentToSearchText, parsePageBlocks } from "../lib/pageContent";
import { normalizeCoverUrl, normalizePageIcon } from "../lib/pageMetadata";
import { childPagesForParent, moveTargetPages } from "../lib/pageTree";
import { subpageSectionMode } from "../lib/subpageSection";
import { useAppStore } from "../store/useAppStore";
import { FloatingPopover } from "./FloatingPopover";

const ICON_OPTIONS = ["📄", "✅", "💡", "📌", "🚀", "🧠", "🛠️", "📚", "🎯", "✨", "🔥", "📝"];

type BlockDropTarget = {
  blockId: string;
  placement: BlockDropPlacement;
  element: HTMLElement;
};

function moveEditorBlock(editor: BlockNoteEditor, sourceId: string, targetId: string, placement: BlockDropPlacement) {
  if (sourceId === targetId) return;

  const sourceBlock = editor.getBlock(sourceId);
  const targetBlock = editor.getBlock(targetId);

  if (!sourceBlock || !targetBlock || blockContainsId(sourceBlock, targetId)) {
    return;
  }

  editor.transact(() => {
    editor.removeBlocks([sourceBlock]);
    editor.insertBlocks([sourceBlock], targetBlock, placement);
  });
}

function blockContainsId(block: Block, blockId: string): boolean {
  return block.children.some((child) => child.id === blockId || blockContainsId(child, blockId));
}

function clearBlockDropIndicator() {
  document
    .querySelectorAll<HTMLElement>("[data-opennotion-block-drop]")
    .forEach((element) => element.removeAttribute("data-opennotion-block-drop"));
}

function blockElementFromPoint(editor: BlockNoteEditor, clientX: number, clientY: number): HTMLElement | null {
  const editorElement = editor.domElement;

  if (!editorElement) return null;

  const editorRect = editorElement.getBoundingClientRect();
  const x = Math.min(Math.max(clientX, editorRect.left + 8), editorRect.right - 8);
  const element = document
    .elementsFromPoint(x, clientY)
    .find((candidate) => editorElement.contains(candidate) && candidate.closest(".bn-block-outer[data-id]"));

  return (element?.closest(".bn-block-outer[data-id]") as HTMLElement | null) ?? null;
}

function blockDropTargetFromPoint(editor: BlockNoteEditor, clientX: number, clientY: number, sourceId: string): BlockDropTarget | null {
  const element = blockElementFromPoint(editor, clientX, clientY);
  const blockId = element?.dataset.id;

  if (!element || !blockId || blockId === sourceId) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const placement = blockDropPlacementFromOffset(clientY - rect.top, rect.height);

  return { blockId, placement, element };
}

function OpenNotionSideMenu() {
  return (
    <SideMenu>
      <AddBlockButton />
      <OpenNotionDragHandleButton />
    </SideMenu>
  );
}

function isNativeTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function preserveEditorScroll(editor: BlockNoteEditor<any, any, any>) {
  const scrollContainer = editor.domElement?.closest(".on-scroll-fade");
  if (!(scrollContainer instanceof HTMLElement)) return () => {};

  const scrollTop = scrollContainer.scrollTop;
  const restore = () => {
    scrollContainer.scrollTop = scrollTop;
  };

  return () => {
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    window.setTimeout(restore, 0);
  };
}

function isEmptyEditorBlock(block: Block<any, any, any>): boolean {
  if (block.children.length > 0) return false;
  const content = block.content as unknown;
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return true;

  return content.every((item) => {
    if (typeof item === "string") return item.trim().length === 0;
    if (typeof item !== "object" || item === null || Array.isArray(item)) return true;
    return !("text" in item) || typeof item.text !== "string" || item.text.trim().length === 0;
  });
}

function OpenNotionDragHandleButton() {
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
      aria-label="Drag block"
      onPointerDown={handlePointerDown}
    >
      <GripVertical className="h-5 w-5" />
    </button>
  );
}

function openNotionSlashMenuItems(editor: BlockNoteEditor<any, any, any>) {
  return async (query: string) =>
    filterSuggestionItems(
      [
        ...getDefaultReactSlashMenuItems(editor),
        {
          ...formulaSlashMenuItem(editor),
          icon: <Sigma size={18} />,
        },
      ],
      query
    );
}

function OpenNotionBlockTypeSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
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
        icon: RiFormula,
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

  const shouldShow = selectItems.some((item) => item.isSelected);

  if (!shouldShow || !editor.isEditable) {
    return null;
  }

  return <Components.FormattingToolbar.Select className="bn-select" items={selectItems} />;
}

function OpenNotionFormattingToolbar() {
  return (
    <FormattingToolbar>
      <OpenNotionBlockTypeSelect />
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
  return (
    <FloatingPopover
      anchorElement={anchorElement}
      open={open}
      width={224}
      placement={align === "end" ? "bottom-end" : "bottom-start"}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
        onClick={onCreateBlank}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        Blank page
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
          <span className="truncate">{template.title || "Untitled"}</span>
        </button>
      ))}
    </FloatingPopover>
  );
}

export function Editor({
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
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Partial<Page>>({});
  const isSavingRef = useRef(false);
  const isNormalizingMathRef = useRef(false);
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
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [saveState, dispatchSaveState] = useReducer(editorSaveReducer, { status: "saved" });
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const addPage = useAppStore((state) => state.addPage);
  const addPageFromTemplate = useAppStore((state) => state.addPageFromTemplate);
  const duplicatePageAction = useAppStore((state) => state.duplicatePageAction);
  const movePageAction = useAppStore((state) => state.movePageAction);
  const removePage = useAppStore((state) => state.removePage);
  const toggleFavoriteAction = useAppStore((state) => state.toggleFavoriteAction);
  const toggleTemplateAction = useAppStore((state) => state.toggleTemplateAction);
  const appTheme = useAppStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const initialContent = useMemo(() => parsePageBlocks(page.content), [page.id]);
  const breadcrumbs = useMemo(() => pageBreadcrumb(pages, page.id), [page.id, pages]);
  const databaseParentPage = useMemo(
    () => pages.find((candidate) => candidate.id === page.parent_id && candidate.is_database === 1) ?? null,
    [page.parent_id, pages]
  );
  const childPages = useMemo(() => childPagesForParent(pages, page.id), [page.id, pages]);
  const templatePages = useMemo(() => pages.filter((candidate) => candidate.is_template === 1), [pages]);
  const movablePages = useMemo(() => {
    const query = moveQuery.trim().toLowerCase();
    const targets = moveTargetPages(pages, page.id);

    if (!query) return targets;

    return targets.filter((candidate) => (candidate.title || "Untitled").toLowerCase().includes(query));
  }, [moveQuery, page.id, pages]);
  const subpageMode = subpageSectionMode(childPages.length);
  const editor = useMemo(
    () =>
      BlockNoteEditor.create({
        schema: openNotionEditorSchema,
        initialContent,
        uploadFile: async (file) => {
          const importedPath = await importEditorImage(file, page.id);
          return coverImageSrc(importedPath);
        },
        pasteHandler: ({ event, editor, defaultPasteHandler }) => {
          const imageFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
            file.type.startsWith("image/")
          );
          const pastedText = event.clipboardData?.getData("text/plain") ?? "";
          const mathBlocks = imageFiles.length === 0 ? blocksFromPastedMathText(pastedText) : null;

          if (mathBlocks) {
            const cursorBlock = editor.getTextCursorPosition().block;
            if (isEmptyEditorBlock(cursorBlock)) {
              editor.replaceBlocks([cursorBlock], mathBlocks as never);
            } else {
              editor.insertBlocks(mathBlocks as never, cursorBlock, "after");
            }
            return true;
          }

          if (imageFiles.length === 0) {
            return defaultPasteHandler();
          }

          void Promise.all(
            imageFiles.map(async (file) => {
              const importedPath = await importEditorImage(file, page.id);
              return { name: file.name || "Pasted image", url: coverImageSrc(importedPath) };
            })
          ).then((images) => {
            const cursorBlock = editor.getTextCursorPosition().block;
            editor.insertBlocks(
              images.map((image) => ({
                type: "image",
                props: image,
              })),
              cursorBlock,
              "after"
            );
          });

          return true;
        },
      }),
    [page.id]
  );
  const blockNoteTheme = appTheme === "dark" || (appTheme === "system" && systemDark) ? "dark" : "light";
  const isStudioVariant = variant === "studio";
  const slashMenuItems = useMemo(() => openNotionSlashMenuItems(editor), [editor]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);

    setSystemDark(query.matches);
    query.addEventListener("change", handleChange);

    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    setTitle(page.title || "");
    setIcon(page.icon || "");
    setCoverUrl(page.cover_url || "");
    setIsIconMenuOpen(false);
    setIsCoverInputOpen(false);
    setSubpageMenuOpen(false);
    setPageMenuOpen(false);
    setMoveMenuOpen(false);
    setMoveQuery("");
    setIsDeleteConfirmOpen(false);
    pendingUpdatesRef.current = {};
    isSavingRef.current = false;
    dispatchSaveState({ type: "saved" });

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [page.id]);

  useEffect(() => {
    if (!isIconMenuOpen) return;

    requestAnimationFrame(() => {
      iconInputRef.current?.focus();
    });
  }, [isIconMenuOpen]);

  const saveNow = useCallback(async () => {
    if (isSavingRef.current) return;

    const updates = pendingUpdatesRef.current;
    if (Object.keys(updates).length === 0) return;

    pendingUpdatesRef.current = {};
    isSavingRef.current = true;
    dispatchSaveState({ type: "saving" });

    try {
      await updatePage(page.id, updates);
      isSavingRef.current = false;

      if (Object.keys(pendingUpdatesRef.current).length > 0) {
        dispatchSaveState({ type: "edit" });
        if (saveTimeoutRef.current) {
          window.clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = window.setTimeout(() => {
          void saveNow();
        }, 300);
      } else {
        dispatchSaveState({ type: "saved" });
      }
    } catch (error: unknown) {
      isSavingRef.current = false;
      dispatchSaveState({ type: "failed", message: errorMessage(error) });
      console.error("Failed to save page:", error);
    }
  }, [page.id]);

  const queueSave = useCallback((updates: Partial<Page>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    updatePageOptimistically(page.id, updates);
    dispatchSaveState({ type: "edit" });

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, 300);
  }, [page.id, saveNow, updatePageOptimistically]);

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

    titleEnterModifierRef.current = event.altKey || event.shiftKey;

    if (titleEnterModifierRef.current) {
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

  const handleEditorChange = () => {
    if (!isNormalizingMathRef.current) {
      isNormalizingMathRef.current = true;
      const normalized = normalizeMathInlineContentInEditor(editor);
      isNormalizingMathRef.current = false;

      if (normalized) return;
    }

    const content = JSON.stringify(editor.document as Block[]);
    queueSave({ content, search_text: pageContentToSearchText(content) });
  };

  useEffect(() => {
    isNormalizingMathRef.current = true;
    const normalized = normalizeMathInlineContentInEditor(editor);
    isNormalizingMathRef.current = false;

    if (!normalized) return;

    const content = JSON.stringify(editor.document as Block[]);
    queueSave({ content, search_text: pageContentToSearchText(content) });
  }, [editor, page.id, queueSave]);

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
      const path = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });

      if (!path || Array.isArray(path)) return;

      const importedPath = await importCoverImage(path, page.id);
      setCoverUrl(importedPath);
      setIsCoverInputOpen(false);
      queueSave({ cover_url: importedPath });
    } catch (error: unknown) {
      console.error("Failed to import cover image:", error);
      dispatchSaveState({ type: "failed", message: errorMessage(error) });
    }
  };

  const handleRemoveIcon = () => {
    setIcon("");
    setIsIconMenuOpen(false);
    queueSave({ icon: null });
  };

  const handleOpenNativeIconPicker = () => {
    iconInputRef.current?.focus();
    void invoke("show_character_palette").catch((error: unknown) => {
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

  const handleToggleFavorite = async () => {
    setPageMenuOpen(false);
    await toggleFavoriteAction(page.id, page.is_favorite !== 1);
  };

  const handleToggleTemplate = async () => {
    setPageMenuOpen(false);
    await toggleTemplateAction(page.id, page.is_template !== 1);
  };

  const handleTurnIntoDatabase = () => {
    setPageMenuOpen(false);
    queueSave({
      is_database: 1,
      database_schema: JSON.stringify(defaultDatabaseSchema()),
    });
  };

  const handleDuplicatePage = async () => {
    setPageMenuOpen(false);
    const duplicated = await duplicatePageAction(page.id);
    if (duplicated) {
      onSelectPage(duplicated.id);
    }
  };

  const handleOpenMoveMenu = () => {
    setPageMenuOpen(false);
    setMoveMenuOpen(true);
    setMoveQuery("");
  };

  const handleMovePage = async (parentId: string | null) => {
    await movePageAction(page.id, parentId);
    setMoveMenuOpen(false);
    setMoveQuery("");
  };

  const handleRequestDelete = () => {
    setPageMenuOpen(false);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    await removePage(page.id);
    setIsDeleteConfirmOpen(false);
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
      editor.setSelection(firstBlock, lastBlock);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      void saveNow();
    }
  };

  return (
    <div className="flex flex-col h-full w-full relative" onKeyDown={handleKeyDown}>
      <div className="on-scroll-fade flex-1 w-full overflow-y-auto">
        <div className={`${isStudioVariant ? "max-w-none px-8 pt-8" : "max-w-3xl px-8 pt-20"} mx-auto flex min-h-full w-full flex-col pb-16`}>
        {!isStudioVariant && (
        <div className="mb-6 flex min-h-7 items-center gap-1 overflow-hidden text-xs text-muted-foreground">
          {breadcrumbs.map((breadcrumb, index) => {
            const isCurrent = breadcrumb.id === page.id;
            return (
              <div key={breadcrumb.id} className="flex min-w-0 items-center gap-1">
                {index > 0 && <span className="text-muted-foreground/50">/</span>}
                <button
                  type="button"
                  className={`truncate rounded px-1.5 py-1 hover:bg-muted hover:text-foreground ${isCurrent ? "text-foreground/80" : ""}`}
                  disabled={isCurrent}
                  onClick={() => onSelectPage(breadcrumb.id)}
                >
                  {breadcrumb.icon ? `${breadcrumb.icon} ` : ""}
                  {breadcrumb.title || "Untitled"}
                </button>
              </div>
            );
          })}
        </div>
        )}

        {!isStudioVariant && (
        <div className="group/page-actions mb-3 flex min-h-7 items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2 opacity-0 transition-opacity group-hover/page-actions:opacity-100 focus-within:opacity-100">
            {!icon && (
              <button
                ref={iconMenuButtonRef}
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                onClick={() => setIsIconMenuOpen((open) => !open)}
              >
                <Smile className="h-3.5 w-3.5" />
                Add icon
              </button>
            )}
            {!coverUrl && !isCoverInputOpen && (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                onClick={() => void handlePickCoverImage()}
              >
                <Image className="h-3.5 w-3.5" />
                Add cover
              </button>
            )}
            {coverUrl && (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                onClick={() => void handlePickCoverImage()}
              >
                <Image className="h-3.5 w-3.5" />
                Change cover
              </button>
            )}
            <button
              type="button"
              className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
              onClick={() => setIsCoverInputOpen((open) => !open)}
            >
              Cover URL
            </button>
            {isCoverInputOpen && (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                <Image className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                <input
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                  value={coverUrl}
                  placeholder="Paste cover image URL"
                  aria-label="Cover image URL"
                  onChange={(event) => handleCoverUrlChange(event.target.value)}
                  autoFocus
                />
                {coverUrl && (
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-muted"
                    aria-label="Remove cover"
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
                Choose file
              </button>
            )}
          </div>
          <div className="relative flex flex-shrink-0 items-center gap-2">
            <div
              className={`${saveState.status === "error" ? "text-destructive" : ""}`}
              title={saveState.status === "error" ? saveState.message : "Save status"}
            >
              {saveStatusLabel(saveState)}
            </div>
            <button
              type="button"
              ref={pageMenuButtonRef}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Page actions"
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
              className="overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => void handleDuplicatePage()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                Duplicate
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={handleOpenMoveMenu}
              >
                <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
                Move to...
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => void handleToggleFavorite()}
              >
                <Star className={`h-3.5 w-3.5 text-muted-foreground ${page.is_favorite === 1 ? "fill-current" : ""}`} />
                {page.is_favorite === 1 ? "Remove from Favorites" : "Add to Favorites"}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => void handleToggleTemplate()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {page.is_template === 1 ? "Remove from Templates" : "Use as Template"}
              </button>
              {page.is_database !== 1 && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={handleTurnIntoDatabase}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Turn into Database
                </button>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                onClick={handleRequestDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </FloatingPopover>
            <FloatingPopover
              anchorElement={pageMenuButtonRef.current}
              open={moveMenuOpen}
              width={288}
              placement="bottom-end"
              onOpenChange={setMoveMenuOpen}
              className="overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              <div className="border-b border-border p-2">
                <input
                  className="w-full rounded-md bg-muted px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="Move to..."
                  value={moveQuery}
                  onChange={(event) => setMoveQuery(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => void handleMovePage(null)}
                >
                  <span className="truncate text-muted-foreground">Root</span>
                  {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {movablePages.map((target) => (
                  <button
                    type="button"
                    key={target.id}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => void handleMovePage(target.id)}
                  >
                    <span className="truncate">
                      {target.icon ? `${target.icon} ` : ""}
                      {target.title || "Untitled"}
                    </span>
                    {page.parent_id === target.id && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                ))}
                {movablePages.length === 0 && moveQuery.trim() && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">No pages found.</div>
                )}
              </div>
            </FloatingPopover>
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
                Change cover
              </button>
              <button
                type="button"
                className="rounded-md bg-background/85 p-1 text-muted-foreground shadow-sm hover:text-foreground"
                aria-label="Remove cover"
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
              aria-label="Change page icon"
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
              className="rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl"
            >
              <button
                type="button"
                className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleOpenNativeIconPicker}
              >
                <Smile className="h-3.5 w-3.5 text-muted-foreground" />
                Open native picker
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
                  placeholder="Custom icon"
                  aria-label="Custom page icon"
                  onChange={(event) => handleIconChange(event.target.value)}
                  autoFocus
                />
                {icon && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Remove icon"
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
        <div className={`${isStudioVariant ? "mb-6" : "mb-4"} flex items-start gap-4`}>
          <textarea
            ref={titleInputRef}
            className={`${isStudioVariant ? "text-2xl" : "text-4xl"} min-h-[1.15em] min-w-0 flex-1 resize-none overflow-hidden bg-transparent font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground`}
            value={title}
            placeholder="Untitled"
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
                <span>Add subpage</span>
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
            Template
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
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subpages</div>
              <div className="relative">
                <button
                  ref={subpageMenuButtonRef}
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setSubpageMenuOpen((open) => !open)}
                >
                  New subpage
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
            {childPages.map((childPage) => (
              <button
                key={childPage.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                onClick={() => onSelectPage(childPage.id)}
              >
                {childPage.icon ? (
                  <span className="flex h-5 w-5 items-center justify-center text-sm">{childPage.icon}</span>
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="truncate">{childPage.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="on-page-editor-blocks relative -ml-10 flex-1 overflow-visible bg-transparent pl-10">
          <BlockNoteView
            editor={editor}
            theme={blockNoteTheme}
            formattingToolbar={false}
            slashMenu={false}
            sideMenu={false}
            portalElements={{ default: null }}
            onChange={handleEditorChange}
          >
            <FormattingToolbarController formattingToolbar={OpenNotionFormattingToolbar} />
            <SuggestionMenuController triggerCharacter="/" getItems={slashMenuItems} />
            <SideMenuController sideMenu={OpenNotionSideMenu} />
          </BlockNoteView>
        </div>
      </div>
      </div>
      {isDeleteConfirmOpen && (
        <div className="on-modal-overlay z-[150] items-center justify-center">
          <div className="on-modal-panel w-[420px]">
            <div className="flex items-start gap-3 border-b border-border p-4">
              <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">Delete permanently?</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {childPages.length > 0
                    ? `Delete "${title || "Untitled"}" and its subpages permanently? This cannot be undone.`
                    : `Delete "${title || "Untitled"}" permanently? This cannot be undone.`}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3">
              <button
                type="button"
                className="on-button-secondary"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="on-button-danger"
                onClick={() => void handleConfirmDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
