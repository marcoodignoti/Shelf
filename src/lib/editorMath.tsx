import { Block, BlockNoteEditor, BlockNoteSchema, PartialBlock, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, createReactInlineContentSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import katex from "katex";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FloatingPopover } from "../components/FloatingPopover";

const DEFAULT_FORMULA = "\\nabla \\cdot \\vec{E}";
const KATEX_MACROS = {
  "\\zigzag": "\\mathrel{\\diagup\\!\\diagdown\\!\\diagup\\!\\diagdown}",
};

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

type KatexRendererProps = {
  formula: string;
  displayMode?: boolean;
  className?: string;
};

export const KatexRenderer = memo(function KatexRenderer({
  formula,
  displayMode = false,
  className,
}: KatexRendererProps) {
  const html = useMemo(() => renderFormulaHtml(formula, displayMode), [formula, displayMode]);

  return (
    <span
      className={className ?? (displayMode ? "katex-block-wrapper" : "katex-inline-wrapper")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

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
    render: ({ inlineContent, updateInlineContent, editor, contentRef }) => {
      const formula = inlineContent.props.formula;
      const [isEditing, setIsEditing] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      const inputRef = useRef<HTMLInputElement>(null);

      useEffect(() => {
        if (isEditing) {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }, [isEditing]);

      const focusEditor = () => {
        window.requestAnimationFrame(() => {
          editor.focus();
        });
      };

      const closeEditor = () => {
        setIsEditing(false);
        focusEditor();
      };

      return (
        <span ref={contentRef} className="on-inline-math-shell">
          <button
            ref={triggerRef}
            type="button"
            className="on-inline-math"
            title={formula}
            aria-label={`Formula: ${formula}`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsEditing(true);
            }}
          >
            <KatexRenderer formula={formula} />
          </button>
          <FloatingPopover
            anchorElement={triggerRef.current}
            open={isEditing}
            width={320}
            zIndex={220}
            onOpenChange={(open) => {
              if (open) {
                setIsEditing(true);
              } else {
                closeEditor();
              }
            }}
            className="on-inline-math-popover"
          >
            <div
              className="on-inline-math-popover-panel"
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                ref={inputRef}
                className="on-inline-math-input"
                value={formula}
                aria-label="Inline formula input"
                spellCheck={false}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    closeEditor();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeEditor();
                  }
                }}
                onChange={(event) => {
                  updateInlineContent({ type: "math", props: { formula: event.currentTarget.value } });
                }}
              />
            </div>
          </FloatingPopover>
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
        >
          <KatexRenderer formula={formula} />
        </span>
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
      >
        <KatexRenderer formula={formula} displayMode />
      </button>
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
          >
            <KatexRenderer formula={formula} displayMode />
          </div>
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
    group: "Math",
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
    if (block.type === "codeBlock") {
      block.children.forEach(visit);
      return;
    }

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
    blocks.push(...blocksFromMarkdownLikeLines(paragraphLines.splice(0)));
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
  if (changed) return { changed: true, content: items };

  const undelimited = splitUndelimitedLatexExpressions(text, styles);
  if (undelimited) return undelimited;

  return { changed: false, content: [{ type: "text", text, styles }] };
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

  const undelimitedFormula = undelimitedLatexFormulaFromText(formula);
  if (undelimitedFormula) return undelimitedFormula;

  return standaloneLatexFormula(formula);
}

function findNextFormulaToken(text: string, startIndex: number): { start: number; open: "$$" | "$" | "[" | "(" | "\\[" | "\\("; close: "$$" | "$" | "]" | ")" | "\\]" | "\\)" } | null {
  let nextToken: { start: number; open: "$$" | "$" | "[" | "(" | "\\[" | "\\("; close: "$$" | "$" | "]" | ")" | "\\]" | "\\)" } | null = null;

  for (let index = startIndex; index < text.length; index += 1) {
    if (text.startsWith("\\[", index)) {
      nextToken = { start: index, open: "\\[", close: "\\]" };
      break;
    }

    if (text.startsWith("\\(", index)) {
      nextToken = { start: index, open: "\\(", close: "\\)" };
      break;
    }

    if (text.startsWith("$$", index) && text[index - 1] !== "\\") {
      nextToken = { start: index, open: "$$", close: "$$" };
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

function findUnescapedDelimiter(text: string, delimiter: "$$" | "$" | "]" | ")" | "\\]" | "\\)", startIndex: number): number {
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

function isInlineFormula(formula: string, delimiter: "$$" | "$" | "[" | "(" | "\\[" | "\\("): boolean {
  if (!formula || formula.includes("\n")) return false;
  return delimiter === "$" || delimiter === "$$" || delimiter === "\\[" || delimiter === "\\(" || isLikelyLatexFormula(formula);
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
  return /\\(?:oint|int|nabla|vec|cdot|frac|partial|Sigma|Gamma|Delta|Phi|Omega|ell|varepsilon|mathcal|mu|rho|pm|mp|times|div|sqrt|hat|left|right|text|qquad|quad|forall|leq|geq|approx)\b/.test(value) ||
    /[_^][{\\\w]/.test(value) ||
    /\\[a-zA-Z]+\{/.test(value);
}

function blocksFromMarkdownLikeLines(lines: string[]): PartialBlock[] {
  const blocks: PartialBlock[] = [];
  let codeFence: { language: string; lines: string[] } | null = null;

  const flushCodeFence = () => {
    if (!codeFence) return;
    blocks.push({
      type: "codeBlock",
      props: { language: codeFence.language },
      content: codeFence.lines.join("\n"),
    } as unknown as PartialBlock);
    codeFence = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (codeFence) {
      if (trimmed === "```") {
        flushCodeFence();
      } else {
        codeFence.lines.push(line);
      }
      continue;
    }

    if (!trimmed) continue;

    const codeFenceMatch = trimmed.match(/^```([A-Za-z0-9_-]+)?$/);
    if (codeFenceMatch) {
      codeFence = { language: codeFenceMatch[1] ?? "", lines: [] };
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        props: { level: headingMatch[1].length },
        content: contentFromMarkdownLikeLine(headingMatch[2]),
      } as unknown as PartialBlock);
      continue;
    }

    const checklistMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checklistMatch) {
      blocks.push({
        type: "checkListItem",
        props: { checked: checklistMatch[1].toLowerCase() === "x" },
        content: contentFromMarkdownLikeLine(checklistMatch[2]),
      } as unknown as PartialBlock);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        type: "bulletListItem",
        content: contentFromMarkdownLikeLine(bulletMatch[1]),
      } as unknown as PartialBlock);
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        type: "numberedListItem",
        content: contentFromMarkdownLikeLine(numberedMatch[1]),
      } as unknown as PartialBlock);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    blocks.push({
      type: "paragraph",
      content: contentFromMarkdownLikeLine(quoteMatch?.[1] ?? line),
    } as unknown as PartialBlock);
  }

  flushCodeFence();
  return blocks;
}

function contentFromMarkdownLikeLine(line: string): string | InlineContent[] {
  const normalized = normalizeMathInlineContent([{ type: "text", text: line, styles: {} }]);
  return normalized.changed ? normalized.content : line;
}

function splitUndelimitedLatexExpressions(text: string, styles: Record<string, unknown>): {
  changed: boolean;
  content: InlineContent[];
} | null {
  const items: InlineContent[] = [];
  let cursor = 0;
  let changed = false;

  while (cursor < text.length) {
    const expression = findNextUndelimitedLatexExpression(text, cursor);
    if (!expression) break;

    pushText(items, text.slice(cursor, expression.start), styles);
    items.push({ type: "math", props: { formula: expression.formula } });
    changed = true;
    cursor = expression.end;
  }

  if (!changed) return null;

  pushText(items, text.slice(cursor), styles);
  return { changed: true, content: items };
}

function undelimitedLatexFormulaFromText(text: string): string | null {
  const expression = readUndelimitedLatexExpression(text.trim(), 0);
  if (!expression || expression.end !== text.trim().length) return null;
  return expression.formula;
}

function findNextUndelimitedLatexExpression(text: string, startIndex: number): {
  start: number;
  end: number;
  formula: string;
} | null {
  for (let index = startIndex; index < text.length; index += 1) {
    if (!isFormulaStartBoundary(text, index)) continue;
    if (text[index] !== "\\" && !/[A-Za-z]/.test(text[index])) continue;

    const expression = readUndelimitedLatexExpression(text, index);
    if (expression) return { start: index, ...expression };
  }

  return null;
}

function readUndelimitedLatexExpression(text: string, startIndex: number): {
  end: number;
  formula: string;
} | null {
  const firstAtom = readMathAtom(text, startIndex);
  if (!firstAtom) return null;

  let cursor = skipSpaces(text, firstAtom.end);
  const relation = readMathRelation(text, cursor);
  if (!relation) return null;

  cursor = skipSpaces(text, relation.end);
  let sawLatexSyntax = firstAtom.hasLatexSyntax || relation.hasLatexSyntax;
  let lastGoodEnd = sawLatexSyntax ? cursor : -1;
  let tokenCount = 0;

  while (cursor < text.length) {
    const spacedCursor = skipSpaces(text, cursor);
    if (spacedCursor > cursor && /^[A-Za-z]\s+[A-Za-zÀ-ÿ]{2,}\b/.test(text.slice(spacedCursor))) {
      break;
    }

    cursor = spacedCursor;
    if (cursor >= text.length || /[:;,.]/.test(text[cursor])) break;

    const operator = readMathOperator(text, cursor);
    if (operator) {
      sawLatexSyntax ||= operator.hasLatexSyntax;
      cursor = skipSpaces(text, operator.end);
      continue;
    }

    const atom = readMathAtom(text, cursor);
    if (!atom) break;

    sawLatexSyntax ||= atom.hasLatexSyntax;
    tokenCount += 1;
    cursor = atom.end;

    if (sawLatexSyntax && tokenCount > 0) {
      lastGoodEnd = cursor;
    }
  }

  if (lastGoodEnd === -1) return null;

  const formula = text.slice(startIndex, lastGoodEnd).trim();
  if (!isLikelyLatexFormula(formula) || containsProseText(formula)) return null;

  return {
    end: lastGoodEnd,
    formula,
  };
}

function skipSpaces(text: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function isFormulaStartBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return !/[A-Za-z0-9_\\]/.test(text[index - 1]);
}

function readMathRelation(text: string, startIndex: number): { end: number; hasLatexSyntax: boolean } | null {
  for (const relation of ["\\leq", "\\geq", "\\approx"]) {
    if (text.startsWith(relation, startIndex)) {
      return { end: startIndex + relation.length, hasLatexSyntax: true };
    }
  }

  if (/[=<>]/.test(text[startIndex])) {
    return { end: startIndex + 1, hasLatexSyntax: false };
  }

  return null;
}

function readMathOperator(text: string, startIndex: number): { end: number; hasLatexSyntax: boolean } | null {
  for (const operator of ["\\cdot", "\\times", "\\div", "\\pm", "\\mp", "\\qquad", "\\quad", "\\forall"]) {
    if (text.startsWith(operator, startIndex)) {
      return { end: startIndex + operator.length, hasLatexSyntax: true };
    }
  }

  if (/[-+*/=<>()[\]]/.test(text[startIndex])) {
    return { end: startIndex + 1, hasLatexSyntax: false };
  }

  return null;
}

function readMathAtom(text: string, startIndex: number): { end: number; hasLatexSyntax: boolean } | null {
  if (text.startsWith("\\ ", startIndex)) {
    return { end: startIndex + 2, hasLatexSyntax: true };
  }

  const commandMatch = text.slice(startIndex).match(/^\\[a-zA-Z]+/);
  if (commandMatch) {
    let cursor = startIndex + commandMatch[0].length;
    cursor = consumeOptionalBracedGroups(text, cursor);
    cursor = consumeMathSuffixes(text, cursor);
    return { end: cursor, hasLatexSyntax: true };
  }

  const numberMatch = text.slice(startIndex).match(/^\d+(?:[.,]\d+)?/);
  if (numberMatch) {
    let cursor = startIndex + numberMatch[0].length;
    cursor = consumeMathSuffixes(text, cursor);
    return { end: cursor, hasLatexSyntax: cursor > startIndex + numberMatch[0].length };
  }

  const wordMatch = text.slice(startIndex).match(/^[A-Za-z]+/);
  if (wordMatch) {
    let cursor = startIndex + wordMatch[0].length;
    cursor = consumeMathSuffixes(text, cursor);
    const hasSuffix = cursor > startIndex + wordMatch[0].length;
    if (wordMatch[0].length > 1 && !hasSuffix) return null;
    return { end: cursor, hasLatexSyntax: hasSuffix };
  }

  return null;
}

function consumeOptionalBracedGroups(text: string, startIndex: number): number {
  let cursor = startIndex;

  while (text[cursor] === "{") {
    const end = findMatchingBrace(text, cursor);
    if (end === -1) break;
    cursor = end + 1;
  }

  return cursor;
}

function consumeMathSuffixes(text: string, startIndex: number): number {
  let cursor = startIndex;

  while (text[cursor] === "_" || text[cursor] === "^") {
    cursor += 1;
    if (text[cursor] === "{") {
      const end = findMatchingBrace(text, cursor);
      if (end === -1) return cursor;
      cursor = end + 1;
    } else if (text[cursor] === "\\") {
      const commandMatch = text.slice(cursor).match(/^\\[a-zA-Z]+/);
      if (!commandMatch) return cursor;
      cursor += commandMatch[0].length;
    } else {
      const valueMatch = text.slice(cursor).match(/^-?\d+|^[A-Za-z0-9]+/);
      if (!valueMatch) return cursor;
      cursor += valueMatch[0].length;
    }
  }

  return cursor;
}

function findMatchingBrace(text: string, startIndex: number): number {
  let depth = 0;

  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
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
  if (!value) return false;
  if (/^[A-Za-z]$/.test(value)) return true;
  if (isLikelyLatexFormula(value)) return true;
  if (/^\\[a-zA-Z]+\s*[()]?$/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*(?:[_^][A-Za-z0-9{}\\]+)+$/.test(value)) return true;
  if (/^[=+\-*/^_{}\\\s\d.,()[\]]+$/.test(value)) return true;

  return !containsProseText(value) && /[=+\-*/^_\\]/.test(value);
}

function containsProseText(value: string): boolean {
  const allowedMathWords = new Set([
    "dt",
    "dx",
    "dy",
    "dz",
    "dl",
    "ds",
    "eq",
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

export function renderFormulaHtml(formula: string, displayMode = false): string {
  return katex.renderToString(normalizeFormulaForKatex(formula || "\\?"), {
    throwOnError: false,
    strict: false,
    output: "html",
    displayMode,
    macros: KATEX_MACROS,
  });
}

function normalizeFormulaForKatex(formula: string): string {
  const strippedFormula = stripFormulaDelimiters(formula);

  return strippedFormula
    .replace(/!!(?=\s*\\zigzag\b)/g, "\\!")
    .replace(/(\\zigzag\b\s*)!!/g, "$1\\!");
}

function stripFormulaDelimiters(formula: string): string {
  let value = formula.trim();

  if (value.startsWith("$$")) {
    value = value.slice(2).trim();
    if (value.endsWith("$$")) value = value.slice(0, -2).trim();
    return value;
  }

  if (value.startsWith("\\[")) {
    value = value.slice(2).trim();
    if (value.endsWith("\\]")) value = value.slice(0, -2).trim();
    return value;
  }

  if (value.startsWith("$")) {
    value = value.slice(1).trim();
    if (value.endsWith("$")) value = value.slice(0, -1).trim();
    return value;
  }

  return value;
}
