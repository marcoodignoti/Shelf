import { Block, BlockNoteEditor, BlockNoteSchema, PartialBlock, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, createReactInlineContentSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import katex from "katex";
import { useEffect, useRef, useState } from "react";

const DEFAULT_FORMULA = "\\nabla \\cdot \\vec{E}";

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
      const [isEditing, setIsEditing] = useState(false);
      const inputRef = useRef<HTMLInputElement>(null);

      useEffect(() => {
        if (isEditing) {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }, [isEditing]);

      return (
        <span ref={contentRef} className="on-inline-math-shell">
          {isEditing ? (
            <input
              ref={inputRef}
              className="on-inline-math-input"
              value={formula}
              aria-label="Inline formula input"
              spellCheck={false}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => {
                updateInlineContent({ type: "math", props: { formula: event.currentTarget.value } });
              }}
            />
          ) : (
            <button
              type="button"
              className="on-inline-math"
              title={formula}
              aria-label={`Formula: ${formula}`}
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={() => setIsEditing(true)}
            />
          )}
        </span>
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

function FormulaBlockContent({
  block,
  editor,
}: {
  block: Block<any, any, any>;
  editor: BlockNoteEditor<any, any, any>;
}) {
  const formula = block.props.formula;
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  return (
    <div className="on-formula-block">
      {isEditing ? (
        <textarea
          ref={inputRef}
          className="on-formula-input"
          value={formula}
          aria-label="Formula input"
          contentEditable={false}
          spellCheck={false}
          onMouseDown={(event) => event.stopPropagation()}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => {
            editor.updateBlock(block, {
              props: {
                formula: event.currentTarget.value,
              },
            });
          }}
        />
      ) : null}
      <button
        type="button"
        className="on-formula-preview on-formula-preview-button"
        aria-label={`Formula preview: ${formula}`}
        contentEditable={false}
        data-latex={formula}
        dangerouslySetInnerHTML={{ __html: renderFormulaHtml(formula) }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsEditing(true);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsEditing(true);
        }}
      />
    </div>
  );
}

export const FormulaBlock = createReactBlockSpec(
  {
    type: "formula",
    content: "none",
    propSchema: {
      formula: {
        default: DEFAULT_FORMULA,
      },
    },
  },
  {
    render: FormulaBlockContent,
    toExternalHTML: ({ block }) => {
      const formula = block.props.formula;

      return (
        <figure className="on-formula-block" data-latex={formula}>
          <div
            className="on-formula-preview"
            dangerouslySetInnerHTML={{ __html: renderFormulaHtml(formula) }}
          />
        </figure>
      );
    },
    parse: (element) => {
      if (!(element instanceof HTMLElement)) return undefined;
      const formula = element.dataset.latex || element.querySelector<HTMLElement>("[data-latex]")?.dataset.latex;
      return formula ? { formula } : undefined;
    },
  }
)();

export function insertFormulaBlock(editor: BlockNoteEditor<any, any, any>) {
  return insertOrUpdateBlockForSlashMenu(editor, {
    type: "formula",
    props: { formula: DEFAULT_FORMULA },
  } as never);
}

export function formulaSlashMenuItem(editor: BlockNoteEditor<any, any, any>): DefaultReactSuggestionItem {
  return {
    title: "Formula",
    subtext: "LaTeX equation block",
    aliases: ["formula", "latex", "math", "equation"],
    group: "Basic blocks",
    onItemClick: () => {
      insertFormulaBlock(editor);
    },
  };
}

export const openNotionEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    formula: FormulaBlock,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInlineContent,
  },
});

export function normalizeMathInlineContentInEditor(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = normalizeBracketedMathBlocks(editor);

  const visit = (block: Block<any, any, any>) => {
    const blockFormula = formulaFromBlockContent(block.content);
    if (blockFormula && block.type !== "formula") {
      changed = true;
      editor.updateBlock(block, {
        type: "formula",
        props: { formula: blockFormula },
        content: undefined,
      } as never);
      return;
    }

    const nextContent = normalizeMathContentDeep(block.content);

    if (nextContent.changed) {
      changed = true;
      editor.updateBlock(block, {
        content: nextContent.content,
        ...(Array.isArray(nextContent.content) &&
        isStandaloneMathContent(nextContent.content as InlineContent[]) &&
        block.type !== "paragraph"
          ? { type: "paragraph" }
          : {}),
      } as never);
    }

    block.children.forEach(visit);
  };

  editor.document.forEach(visit);
  return changed;
}

export function formulaFromBlockContent(content: unknown): string | null {
  return formulaFromText(textFromBlockContent(content));
}

export function formulaInputFromBlockContent(content: unknown): string {
  return formulaFromBlockContent(content) ?? textFromBlockContent(content).trim();
}

export function blocksFromPastedMathText(text: string): PartialBlock[] | null {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  if (!normalizedText.split("\n").some((line) => {
    const trimmed = line.trim();
    return isOpenMathFence(trimmed) || trimmed.startsWith("$$") || trimmed.startsWith("\\[");
  })) {
    return null;
  }

  const blocks: PartialBlock[] = [];
  const paragraphLines: string[] = [];
  let formulaLines: string[] | null = null;

  const flushParagraph = () => {
    for (const line of paragraphLines.splice(0)) {
      if (!line.trim()) continue;
      blocks.push({ type: "paragraph", content: line });
    }
  };

  const flushFormula = () => {
    if (!formulaLines) return true;

    const parts = formulaLines.map((line) => stripClosingMathFence(line.trim())).filter(Boolean);
    if (parts.length === 0 || !parts.every(isLikelyLatexFormulaLine)) {
      return false;
    }

    blocks.push({
      type: "formula",
      props: { formula: parts.join(" ") },
    } as unknown as PartialBlock);
    formulaLines = null;
    return true;
  };

  for (const line of normalizedText.split("\n")) {
    const trimmed = line.trim();

    if (formulaLines) {
      if (isCloseMathFence(trimmed)) {
        if (!flushFormula()) return null;
        continue;
      }

      formulaLines.push(trimmed);
      if (hasClosingMathFence(trimmed)) {
        if (!flushFormula()) return null;
      }
      continue;
    }

    const inlineDisplayFormula = formulaFromText(trimmed);
    if (inlineDisplayFormula && (trimmed.startsWith("$$") || trimmed.startsWith("\\["))) {
      flushParagraph();
      blocks.push({
        type: "formula",
        props: { formula: inlineDisplayFormula },
      } as unknown as PartialBlock);
      continue;
    }

    if (isOpenMathFence(trimmed)) {
      flushParagraph();
      formulaLines = [];
      continue;
    }

    paragraphLines.push(line);
  }

  if (formulaLines) {
    return null;
  }

  flushParagraph();
  return blocks.length > 0 ? blocks : null;
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
  const latexPrefix = latexPrefixBeforeProse(text);
  if (latexPrefix) {
    const content: InlineContent[] = [];
    pushText(content, text.slice(0, latexPrefix.start), styles);
    content.push({ type: "math", props: { formula: latexPrefix.formula } });
    pushText(content, text.slice(latexPrefix.end), styles);

    return { changed: true, content };
  }

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

    const end = findUnescapedDelimiter(text, token.close, token.start + token.open.length);
    if (end === -1) break;

    const formula = text.slice(token.start + token.open.length, end).trim();
    if (!isInlineFormula(formula, token.open)) {
      cursor = end + token.close.length;
      continue;
    }

    pushText(items, text.slice(cursor, token.start), styles);
    items.push({ type: "math", props: { formula } });
    changed = true;
    cursor = end + token.close.length;
  }

  pushText(items, text.slice(cursor), styles);
  return {
    changed,
    content: changed ? items : [{ type: "text", text, styles }],
  };
}

function formulaFromText(text: string): string | null {
  const formula = text.trim();
  if (!formula) return null;

  if (formula.startsWith("$$") && formula.endsWith("$$") && formula.length > 4) {
    const innerFormula = formula.slice(2, -2).trim();
    return isLikelyLatexFormula(innerFormula) ? innerFormula : null;
  }

  if (formula.startsWith("\\[") && formula.endsWith("\\]")) {
    const innerFormula = formula.slice(2, -2).trim();
    return isLikelyLatexFormula(innerFormula) ? innerFormula : null;
  }

  if (formula.startsWith("[") && formula.endsWith("]")) {
    const innerFormula = formula.slice(1, -1).trim();
    return isLikelyLatexFormula(innerFormula) ? innerFormula : null;
  }

  return standaloneLatexFormula(formula);
}

function findNextFormulaToken(text: string, startIndex: number): { start: number; open: "$" | "[" | "(" | "\\[" | "\\("; close: "$" | "]" | ")" | "\\]" | "\\)" } | null {
  let nextToken: { start: number; open: "$" | "[" | "(" | "\\[" | "\\("; close: "$" | "]" | ")" | "\\]" | "\\)" } | null = null;

  for (let index = startIndex; index < text.length; index += 1) {
    if (text.startsWith("\\[", index)) {
      nextToken = { start: index, open: "\\[", close: "\\]" };
      break;
    }

    if (text.startsWith("\\(", index)) {
      nextToken = { start: index, open: "\\(", close: "\\)" };
      break;
    }

    if (text[index] === "$" && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "$", close: "$" };
      break;
    }

    if (text[index] === "[" && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "[", close: "]" };
      break;
    }

    if (text[index] === "(" && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "(", close: ")" };
      break;
    }
  }

  return nextToken;
}

function findUnescapedDelimiter(text: string, delimiter: "$" | "]" | ")" | "\\]" | "\\)", startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (delimiter.length > 1 && text.startsWith(delimiter, index)) {
      return index;
    }

    if (delimiter === "\\]" && text[index] === "]" && text[index - 1] !== "\\") {
      return index;
    }

    if (text[index] === delimiter && text[index - 1] !== "\\") {
      return index;
    }
  }

  return -1;
}

function isInlineFormula(formula: string, delimiter: "$" | "[" | "(" | "\\[" | "\\("): boolean {
  if (!formula || formula.includes("\n")) return false;
  return delimiter === "$" || isLikelyLatexFormula(formula);
}

function latexPrefixBeforeProse(text: string): { start: number; end: number; formula: string } | null {
  const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
  const value = text.slice(leadingWhitespace.length);
  const match = value.match(/^\\[a-zA-Z]+(?:\{[^}]*\})?(?:_[{\\A-Za-z0-9]+}?)?(?:\^[{\\A-Za-z0-9]+}?)?/);
  if (!match) return null;

  const formula = match[0];
  const rest = value.slice(formula.length);
  if (!formula || !containsProseText(rest) || !isLikelyLatexFormula(formula)) return null;

  return {
    start: leadingWhitespace.length,
    end: leadingWhitespace.length + formula.length,
    formula,
  };
}

function standaloneLatexFormula(text: string): string | null {
  const formula = stripUnclosedMathPrefix(text.trim());

  if (!formula.startsWith("\\") || !isLikelyLatexFormula(formula) || containsProseText(formula)) {
    return null;
  }

  return formula;
}

function stripUnclosedMathPrefix(value: string): string {
  if (value.startsWith("(") && !value.endsWith(")") && isLikelyLatexFormula(value.slice(1))) {
    return value.slice(1).trim();
  }

  return value;
}

function isLikelyLatexFormula(value: string): boolean {
  return /\\(?:oint|int|nabla|vec|cdot|frac|partial|Sigma|Gamma|Delta|Phi|varepsilon|mathcal|mu|rho|pm|mp|times|div|sqrt|hat|left|right|text)\b/.test(value) ||
    /[_^][{\\\w]/.test(value) ||
    /\\[a-zA-Z]+\{/.test(value);
}

function normalizeBracketedMathBlocks(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = false;

  const visitSiblings = (blocks: Block<any, any, any>[]) => {
    for (let index = 0; index < blocks.length - 2; index += 1) {
      const openBlock = blocks[index];
      const openText = textFromBlockContent(openBlock.content).trim();
      if (!isOpenMathFence(openText)) continue;

      const closeIndex = blocks.findIndex((block, candidateIndex) => (
        candidateIndex > index + 1 && hasClosingMathFence(textFromMathBlock(block).trim())
      ));
      if (closeIndex === -1) continue;

      const formulaBlocks = blocks.slice(index + 1, closeIndex + 1);
      const formulaParts = formulaBlocks.map((block) => stripClosingMathFence(textFromMathBlock(block).trim())).filter(Boolean);
      if (formulaParts.length === 0 || !formulaParts.every(isLikelyLatexFormulaLine)) continue;

      const formula = formulaParts.join(" ");
      editor.updateBlock(formulaBlocks[0], {
        type: "formula",
        props: { formula },
        content: undefined,
      } as never);

      const blocksToRemove = [openBlock, ...formulaBlocks.slice(1)];
      if (blocksToRemove.length > 0) {
        editor.removeBlocks(blocksToRemove);
        changed = true;
        index = closeIndex;
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

function isOpenMathFence(text: string): boolean {
  return text === "[" || text === "\\[" || text === "$$";
}

function isCloseMathFence(text: string): boolean {
  return text === "]" || text === "\\]" || text === "$$";
}

function hasClosingMathFence(text: string): boolean {
  return isCloseMathFence(text) || (text.endsWith("]") && !text.endsWith("\\]")) || text.endsWith("\\]") || text.endsWith("$$");
}

function stripClosingMathFence(text: string): string {
  if (text.endsWith("$$")) return text.slice(0, -2).trim();
  if (text.endsWith("\\]")) return text.slice(0, -2).trim();
  if (text.endsWith("]")) return text.slice(0, -1).trim();
  return text;
}

function isLikelyLatexFormulaLine(value: string): boolean {
  return !containsProseText(value) && (
    isLikelyLatexFormula(value) ||
    /^\\[a-zA-Z]+\s*[()]?$/.test(value) ||
    /^[A-Za-z][A-Za-z0-9]*(?:[_^][A-Za-z0-9{}\\]+)+$/.test(value) ||
    /^[=+\-*/^_{}\\\s\d.,()[\]]+$/.test(value)
  );
}

function containsProseText(value: string): boolean {
  const allowedMathWords = new Set([
    "dt",
    "dx",
    "dy",
    "dz",
    "dl",
    "ds",
    "sigma",
    "gamma",
    "delta",
    "phi",
    "theta",
    "omega",
    "alpha",
    "beta",
    "rho",
    "mu",
  ]);
  const withoutLatexSyntax = value
    .replace(/\\text\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}_^\\()[\].,;:=+\-*/\d]/g, " ");
  const proseWords = withoutLatexSyntax.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];

  return proseWords.some((word) => !allowedMathWords.has(word.toLowerCase()));
}

function normalizeMathContentDeep(content: unknown): {
  changed: boolean;
  content: unknown;
} {
  if (Array.isArray(content)) {
    const containsInlineContent = content.some((item) => typeof item === "string" || isTextInlineContent(item));

    if (containsInlineContent) {
      return normalizeMathInlineContent(content as InlineContent[]);
    }

    let changed = false;
    const nextContent = content.map((item) => {
      const nextItem = normalizeMathContentDeep(item);
      changed ||= nextItem.changed;
      return nextItem.content;
    });

    return { changed, content: changed ? nextContent : content };
  }

  if (typeof content === "object" && content !== null) {
    let changed = false;
    const nextContent: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(content)) {
      const nextValue = normalizeMathContentDeep(value);
      changed ||= nextValue.changed;
      nextContent[key] = nextValue.content;
    }

    return { changed, content: changed ? nextContent : content };
  }

  return { changed: false, content };
}

function textFromMathBlock(block: Block<any, any, any>): string {
  const formula = block.props?.formula;
  if (typeof formula === "string") return formula;
  return textFromBlockContent(block.content);
}

function textFromBlockContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isTextInlineContent(item)) return item.text;
        if (isMathInlineContent(item)) return item.props.formula;
        return textFromBlockContent(item);
      })
      .join("");
  }

  if (typeof content === "object" && content !== null) {
    return Object.values(content).map(textFromBlockContent).join("");
  }

  return "";
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
