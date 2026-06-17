import { Block, BlockNoteEditor } from "@blocknote/core";

export type HeadingRailItem = {
  id: string;
  level: number;
  title: string;
};

const SPELLCHECK_TARGET_SELECTOR =
  "[contenteditable='true'], textarea, input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url']";

export function isNativeTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

// Only touch elements where spellcheck is meaningful. Setting attributes on
// non-text inputs rendered by ProseMirror node views (e.g. the checklist
// checkbox) makes ProseMirror's DOMObserver re-create the node, which
// re-triggers the MutationObserver below in an infinite loop that freezes
// the app. Covered by tests/e2e/checklist.e2e.ts.
function setSpellcheckAttributes(element: HTMLElement) {
  if (element.getAttribute("spellcheck") !== "false") element.setAttribute("spellcheck", "false");
  if (element.getAttribute("autocorrect") !== "off") element.setAttribute("autocorrect", "off");
  if (element.getAttribute("autocapitalize") !== "off") element.setAttribute("autocapitalize", "off");
}

export function disableSpellcheck(element: HTMLElement | null) {
  if (!element) return;
  setSpellcheckAttributes(element);
  element.querySelectorAll<HTMLElement>(SPELLCHECK_TARGET_SELECTOR).forEach(setSpellcheckAttributes);
}

export function activeElementIsNativeTextInput() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
}

export function blockElementSelector(blockId: string): string {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(blockId)
    : blockId.replace(/"/g, '\\"');

  return `.bn-block-outer[data-id="${escaped}"]`;
}

export function preserveEditorScroll(editor: BlockNoteEditor<any, any, any>) {
  const scrollContainer = editor.domElement?.closest(".on-scroll-fade.flex-1.w-full.overflow-y-auto");
  if (!(scrollContainer instanceof HTMLElement)) return () => {};

  const scrollTop = scrollContainer.scrollTop;
  const restore = () => {
    scrollContainer.scrollTop = scrollTop;
  };

  return () => {
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    });
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 50);
    window.setTimeout(restore, 150);
    window.setTimeout(restore, 300);
  };
}

export function selectionRectInsideEditor(editor: BlockNoteEditor<any, any, any>): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!editor.domElement?.contains(range.commonAncestorContainer)) return null;

  const rect = range.getBoundingClientRect();
  if (rect.height > 0 || rect.width > 0) return rect;

  const block = editor.getTextCursorPosition().block;
  const blockElement = editor.domElement?.querySelector<HTMLElement>(blockElementSelector(block.id));
  return blockElement?.getBoundingClientRect() ?? null;
}

export function keepEditorCaretInView(editor: BlockNoteEditor<any, any, any>, scrollContainer: HTMLElement | null) {
  if (!scrollContainer) return;

  const scroll = () => {
    const caretRect = selectionRectInsideEditor(editor);
    if (!caretRect) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const bottomPadding = 96;
    const topPadding = 72;
    const caretBottom = caretRect.bottom;
    const caretTop = caretRect.top;
    const visibleBottom = containerRect.bottom - bottomPadding;
    const visibleTop = containerRect.top + topPadding;

    if (caretBottom > visibleBottom) {
      scrollContainer.scrollTop += caretBottom - visibleBottom;
      return;
    }

    if (caretTop < visibleTop) {
      scrollContainer.scrollTop -= visibleTop - caretTop;
    }
  };

  requestAnimationFrame(() => {
    scroll();
    requestAnimationFrame(scroll);
  });
}

export function isEmptyEditorBlock(block: Block<any, any, any>): boolean {
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

export function textFromInlineContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item !== "object" || item === null || Array.isArray(item)) return "";
      if ("text" in item && typeof item.text === "string") return item.text;
      if ("props" in item && typeof item.props === "object" && item.props !== null) {
        const props = item.props as Record<string, unknown>;
        return typeof props.formula === "string" ? props.formula : "";
      }
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function headingItemsFromBlocks(blocks: Block<any, any, any>[]): HeadingRailItem[] {
  return blocks.flatMap((block) => {
    const children = Array.isArray(block.children) ? headingItemsFromBlocks(block.children as Block<any, any, any>[]) : [];

    if (block.type !== "heading") {
      return children;
    }

    const props = block.props as Record<string, unknown>;
    const level = typeof props.level === "number" ? props.level : 1;
    const title = textFromInlineContent(block.content) || "";

    return [{ id: block.id, level, title }, ...children];
  });
}
