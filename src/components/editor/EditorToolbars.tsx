import { editorHasBlockWithType } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { AddBlockButton, blockTypeSelectItems, FormattingToolbar, getFormattingToolbarItems, SideMenu, useBlockNoteEditor, useEditorState, useExtensionState } from "@blocknote/react";
import { Check, ChevronDown, GripVertical, Sigma } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { blockDropTargetFromPoint, BlockDropTarget, clearBlockDropIndicator, moveEditorBlock } from "../../lib/editorBlockDrag";
import { preserveEditorScroll } from "../../lib/editorDom";
import { useT } from "../../lib/i18n";
import { formulaInputFromBlockContent } from "../../lib/editorMath";
import { FloatingPopover } from "../FloatingPopover";

export function ShelfSideMenu() {
  return (
    <SideMenu>
      <AddBlockButton />
      <ShelfDragHandleButton />
    </SideMenu>
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

type ShelfBlockTypeItem = {
  name: string;
  type: string;
  props?: Record<string, boolean | number | string>;
  icon: ComponentType<{ size?: number }>;
};

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
    (): ShelfBlockTypeItem[] => [
      ...blockTypeSelectItems(editor),
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
        editor={editor}
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

export function ShelfFormattingToolbar() {
  return (
    <FormattingToolbar>
      <ShelfBlockTypeSelect />
      {getFormattingToolbarItems([]).slice(1)}
    </FormattingToolbar>
  );
}
