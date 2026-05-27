import { Block, BlockNoteEditor, BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactInlineContentSpec } from "@blocknote/react";
import katex from "katex";

type InlineText = {
  type: "text";
  text: string;
  styles?: Record<string, unknown>;
};

type InlineMath = {
  type: "math";
  props: {
    formula: string;
  };
};

type InlineContent = string | InlineText | InlineMath | Record<string, unknown>;

export const MathInlineContent = createReactInlineContentSpec(
  {
    type: "math",
    content: "none",
    propSchema: {
      formula: {
        default: "",
      },
    },
  },
  {
    render: ({ inlineContent, updateInlineContent, contentRef }) => {
      const formula = inlineContent.props.formula;
      const html = renderFormulaHtml(formula);

      return (
        <button
          ref={contentRef as (node: HTMLButtonElement | null) => void}
          type="button"
          className="on-inline-math"
          title={formula}
          aria-label={`Formula: ${formula}`}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={() => {
            const nextFormula = window.prompt("Edit formula", formula)?.trim();
            if (nextFormula) {
              updateInlineContent({ type: "math", props: { formula: nextFormula } });
            }
          }}
        />
      );
    },
    toExternalHTML: ({ inlineContent, contentRef }) => {
      const formula = inlineContent.props.formula;

      return (
        <span
          ref={contentRef}
          className="on-inline-math"
          data-latex={formula}
          dangerouslySetInnerHTML={{ __html: renderFormulaHtml(formula) }}
        />
      );
    },
    parse: (element) => {
      if (!(element instanceof HTMLElement)) return undefined;
      const formula = element.dataset.latex || element.getAttribute("title");
      return formula ? { formula } : undefined;
    },
  }
);

export const openNotionEditorSchema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInlineContent,
  },
});

export function normalizeMathInlineContentInEditor(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = false;

  const visit = (block: Block<any, any, any>) => {
    if (Array.isArray(block.content)) {
      const nextContent = normalizeMathInlineContent(block.content as InlineContent[]);

      if (nextContent.changed) {
        changed = true;
        editor.updateBlock(block, { content: nextContent.content } as never);
      }
    }

    block.children.forEach(visit);
  };

  editor.document.forEach(visit);
  return changed;
}

export function normalizeMathInlineContent(content: InlineContent[]): {
  changed: boolean;
  content: InlineContent[];
} {
  let changed = false;
  const nextContent = content.flatMap((item) => {
    if (typeof item === "string") {
      const split = splitTextIntoMathInlineContent(item, {});
      changed ||= split.changed;
      return split.content;
    }

    if (!isTextInlineContent(item)) {
      return [item];
    }

    const split = splitTextIntoMathInlineContent(item.text, item.styles ?? {});
    changed ||= split.changed;
    return split.content;
  });

  return {
    changed,
    content: nextContent,
  };
}

function splitTextIntoMathInlineContent(text: string, styles: Record<string, unknown>): {
  changed: boolean;
  content: InlineContent[];
} {
  const items: InlineContent[] = [];
  let changed = false;
  let cursor = 0;

  while (cursor < text.length) {
    const start = findUnescapedDollar(text, cursor);
    if (start === -1) break;

    const end = findUnescapedDollar(text, start + 1);
    if (end === -1) break;

    const formula = text.slice(start + 1, end).trim();
    if (!formula || formula.includes("\n")) {
      cursor = end + 1;
      continue;
    }

    pushText(items, text.slice(cursor, start), styles);
    items.push({ type: "math", props: { formula } });
    changed = true;
    cursor = end + 1;
  }

  pushText(items, text.slice(cursor), styles);
  return {
    changed,
    content: changed ? items : [{ type: "text", text, styles }],
  };
}

function findUnescapedDollar(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "$" && text[index - 1] !== "\\") {
      return index;
    }
  }

  return -1;
}

function pushText(items: InlineContent[], text: string, styles: Record<string, unknown>) {
  if (!text) return;
  items.push({ type: "text", text, styles });
}

function isTextInlineContent(item: InlineContent): item is InlineText {
  return typeof item === "object" && item !== null && !Array.isArray(item) && item.type === "text" && typeof item.text === "string";
}

function renderFormulaHtml(formula: string): string {
  return katex.renderToString(formula || "\\?", {
    throwOnError: false,
    strict: false,
    output: "html",
  });
}
