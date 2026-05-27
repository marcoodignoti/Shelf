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
  let changed = normalizeBracketedMathBlocks(editor);

  const visit = (block: Block<any, any, any>) => {
    if (Array.isArray(block.content)) {
      const nextContent = normalizeMathInlineContent(block.content as InlineContent[]);

      if (nextContent.changed) {
        changed = true;
        editor.updateBlock(block, {
          content: nextContent.content,
          ...(isStandaloneMathContent(nextContent.content) && block.type !== "paragraph"
            ? { type: "paragraph" }
            : {}),
        } as never);
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
  const standaloneFormula = standaloneLatexFormula(text);
  if (standaloneFormula) {
    const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = text.match(/\s*$/)?.[0] ?? "";
    const content: InlineContent[] = [];

    pushText(content, leadingWhitespace, styles);
    content.push({ type: "math", props: { formula: standaloneFormula } });
    pushText(content, trailingWhitespace, styles);

    return { changed: true, content };
  }

  const items: InlineContent[] = [];
  let changed = false;
  let cursor = 0;

  while (cursor < text.length) {
    const token = findNextFormulaToken(text, cursor);
    if (!token) break;

    const end = findUnescapedDelimiter(text, token.close, token.start + 1);
    if (end === -1) break;

    const formula = text.slice(token.start + 1, end).trim();
    if (!isInlineFormula(formula, token.open)) {
      cursor = end + 1;
      continue;
    }

    pushText(items, text.slice(cursor, token.start), styles);
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

function findNextFormulaToken(text: string, startIndex: number): { start: number; open: "$" | "["; close: "$" | "]" } | null {
  let nextToken: { start: number; open: "$" | "["; close: "$" | "]" } | null = null;

  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "$" && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "$", close: "$" };
      break;
    }

    if (text[index] === "[" && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "[", close: "]" };
      break;
    }
  }

  return nextToken;
}

function findUnescapedDelimiter(text: string, delimiter: "$" | "]", startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === delimiter && text[index - 1] !== "\\") {
      return index;
    }
  }

  return -1;
}

function isInlineFormula(formula: string, delimiter: "$" | "["): boolean {
  if (!formula || formula.includes("\n")) return false;
  return delimiter === "$" || isLikelyLatexFormula(formula);
}

function standaloneLatexFormula(text: string): string | null {
  const formula = text.trim();

  if (!formula.startsWith("\\") || !isLikelyLatexFormula(formula)) {
    return null;
  }

  return formula;
}

function isLikelyLatexFormula(value: string): boolean {
  return /\\(?:oint|int|nabla|vec|cdot|frac|partial|Sigma|Gamma|Delta|Phi|varepsilon|mu|rho|text)\b/.test(value) ||
    /[_^][{\\\w]/.test(value) ||
    /\\[a-zA-Z]+\{/.test(value);
}

function normalizeBracketedMathBlocks(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = false;

  const visitSiblings = (blocks: Block<any, any, any>[]) => {
    for (let index = 0; index < blocks.length - 2; index += 1) {
      const openBlock = blocks[index];
      const middleBlock = blocks[index + 1];
      const closeBlock = blocks[index + 2];
      const middleText = textFromBlockContent(middleBlock.content).trim();

      if (
        textFromBlockContent(openBlock.content).trim() === "[" &&
        textFromBlockContent(closeBlock.content).trim() === "]" &&
        standaloneLatexFormula(middleText)
      ) {
        editor.removeBlocks([openBlock, closeBlock]);
        changed = true;
        index += 1;
      }
    }

    blocks.forEach((block) => {
      if (block.children.length > 0) {
        visitSiblings(block.children);
      }
    });
  };

  visitSiblings(editor.document);
  return changed;
}

function textFromBlockContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (isTextInlineContent(item)) return item.text;
      return "";
    })
    .join("");
}

function isStandaloneMathContent(content: InlineContent[]): boolean {
  const meaningfulContent = content.filter((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    if (isTextInlineContent(item)) return item.text.trim().length > 0;
    return true;
  });

  return meaningfulContent.length === 1 && isMathInlineContent(meaningfulContent[0]);
}

function pushText(items: InlineContent[], text: string, styles: Record<string, unknown>) {
  if (!text) return;
  items.push({ type: "text", text, styles });
}

function isTextInlineContent(item: InlineContent): item is InlineText {
  return typeof item === "object" && item !== null && !Array.isArray(item) && item.type === "text" && typeof item.text === "string";
}

function isMathInlineContent(item: InlineContent): item is InlineMath {
  return typeof item === "object" && item !== null && !Array.isArray(item) && item.type === "math";
}

function renderFormulaHtml(formula: string): string {
  return katex.renderToString(formula || "\\?", {
    throwOnError: false,
    strict: false,
    output: "html",
  });
}
