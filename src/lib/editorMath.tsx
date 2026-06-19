import { Block, BlockNoteEditor, BlockNoteSchema, PartialBlock, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, createReactInlineContentSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import katex from "katex";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FloatingPopover } from "../components/FloatingPopover";
import { PageLinkInlineContent } from "./editorLinks";

const DEFAULT_FORMULA = "\\nabla \\cdot \\vec{E}";
export const MAX_FORMULA_LENGTH = 4000;
export const KATEX_MAX_SIZE = 12;
export const KATEX_MAX_EXPAND = 1000;
const KATEX_MACROS = {
  "\\zigzag": "\\mathrel{\\diagup\\!\\diagdown\\!\\diagup\\!\\diagdown}",
};

function preserveEditorScroll(editor: BlockNoteEditor<any, any, any>) {
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
      requestAnimationFrame(restore);
    });
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 50);
  };
}

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
    render: ({ inlineContent, updateInlineContent, editor }) => {
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
        // No contentRef here: this spec is content "none" (leaf). Attaching the
        // content hole to a leaf node makes ProseMirror's clipboard serializer
        // throw "Content hole not allowed in a leaf node spec" on copy.
        <span className="on-inline-math-shell">
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
                  const restoreScroll = preserveEditorScroll(editor);
                  updateInlineContent({ type: "math", props: { formula: event.currentTarget.value } });
                  restoreScroll();
                }}
              />
            </div>
          </FloatingPopover>
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const formula = inlineContent.props.formula;

      return (
        // No contentRef: leaf spec, see the note in render above.
        <span
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
            const restoreScroll = preserveEditorScroll(editor);
            editor.updateBlock(block, {
              props: {
                formula: event.currentTarget.value,
              },
            });
            restoreScroll();
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
    pageLink: PageLinkInlineContent,
  },
});

export function normalizeMathInlineContentInEditor(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = normalizeBracketedMathBlocks(editor);
  changed = normalizeLatexEnvironmentBlocks(editor) || changed;

  const visit = (block: Block<any, any, any>) => {
    if (block.type === "codeBlock") {
      block.children.forEach(visit);
      return;
    }

    if (block.type === "formula") {
      const normalizedFormula = normalizePastedFormula(block.props.formula);
      if (normalizedFormula !== block.props.formula) {
        changed = true;
        editor.updateBlock(block, {
          props: { formula: normalizedFormula },
        } as never);
      }
      block.children.forEach(visit);
      return;
    }

    const standaloneInlineFormula = formulaFromStandaloneMathInlineContent(block.content);
    if (standaloneInlineFormula && block.type !== "formula") {
      changed = true;
      editor.updateBlock(block, {
        type: "formula",
        props: { formula: normalizePastedFormula(standaloneInlineFormula) },
        content: undefined,
      } as never);
      return;
    }

    const blockFormula = formulaFromBlockContent(block.content);
    if (blockFormula && block.type !== "formula") {
      changed = true;
      editor.updateBlock(block, {
        type: "formula",
        props: { formula: normalizePastedFormula(blockFormula) },
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

function formulaFromStandaloneMathInlineContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;

  const meaningfulContent = content.filter((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    if (isTextInlineContent(item)) return item.text.trim().length > 0;
    return true;
  });

  if (meaningfulContent.length !== 1 || !isMathInlineContent(meaningfulContent[0])) return null;
  return meaningfulContent[0].props.formula;
}

export function formulaFromBlockContent(content: unknown): string | null {
  return formulaFromText(textFromBlockContent(content));
}

export function formulaInputFromBlockContent(content: unknown): string {
  return formulaFromBlockContent(content) ?? textFromBlockContent(content).trim();
}

export function blocksFromPastedMathText(text: string): PartialBlock[] | null {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");
  const hasMarkdownTableOrDivider = lines.some((line, index) =>
    isMarkdownDividerLine(line) || readMarkdownTable(lines, index) !== null
  );
  const hasMathFence = lines.some((line) => {
    const trimmed = line.trim();
    return isOpenMathFence(trimmed) || trimmed.startsWith("$$") || trimmed.startsWith("\\[") || isLatexEnvironmentStart(trimmed);
  });

  if (!hasMathFence) {
    const blocks = blocksFromMarkdownLikeLines(lines);
    if (hasMarkdownTableOrDivider) return blocks.length > 0 ? blocks : null;
    if (!isStructuredPlainTextPaste(lines)) return null;
    return blocks.length > 1 ? blocks : null;
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
      props: { formula: normalizePastedFormula(parts.join(" ")) },
    } as unknown as PartialBlock);
    formulaLines = null;
    return true;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
        props: { formula: normalizePastedFormula(inlineDisplayFormula) },
      } as unknown as PartialBlock);
      continue;
    }

    const latexEnvironment = collectLatexEnvironment(lines, index);
    if (latexEnvironment) {
      flushParagraph();
      blocks.push({
        type: "formula",
        props: { formula: latexEnvironment.formula },
      } as unknown as PartialBlock);
      index = latexEnvironment.closeIndex;
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

export function shouldUseBlockNoteMarkdownPaste(text: string): boolean {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");

  if (hasInlineMarkdownSyntax(normalizedText)) return true;

  return lines.some((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    return (
      isOpenMathFence(trimmed) ||
      trimmed.startsWith("$$") ||
      trimmed.startsWith("\\[") ||
      isLatexEnvironmentStart(trimmed) ||
      isMarkdownLikeLine(trimmed) ||
      isSetextHeadingUnderline(lines, index) ||
      readMarkdownTable(lines, index) !== null
    );
  });
}

export function prepareMarkdownForBlockNotePaste(text: string): string {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");
  const protectedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const singleLineFormula = formulaFromText(trimmed);

    if (singleLineFormula && isDelimitedDisplayMathLine(trimmed)) {
      protectedLines.push("", formulaHtmlBlock(singleLineFormula), "");
      continue;
    }

    const latexEnvironment = collectLatexEnvironment(lines, index);
    if (latexEnvironment) {
      protectedLines.push("", formulaHtmlBlock(latexEnvironment.formula), "");
      index = latexEnvironment.closeIndex;
      continue;
    }

    const openFence = openingMathFence(trimmed);
    if (openFence) {
      const collected = collectDisplayMathFence(lines, index, openFence.hasFormulaContent);
      if (collected) {
        protectedLines.push("", formulaHtmlBlock(collected.formula), "");
        index = collected.closeIndex;
        continue;
      }
    }

    protectedLines.push(protectInlineMathForMarkdown(line));
  }

  return protectedLines.join("\n");
}

function isDelimitedDisplayMathLine(text: string): boolean {
  return text.startsWith("$$") || text.startsWith("\\[") || (text.startsWith("[") && text.endsWith("]"));
}

function collectDisplayMathFence(
  lines: string[],
  openIndex: number,
  openingLineHasFormula: boolean
): { formula: string; closeIndex: number } | null {
  const formulaLines: string[] = [];
  const openingLine = lines[openIndex].trim();

  if (openingLineHasFormula) {
    formulaLines.push(stripOpeningMathFence(openingLine));
  }

  for (let index = openIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (isCloseMathFence(trimmed)) {
      const formula = formulaFromFenceLines(formulaLines);
      return formula ? { formula, closeIndex: index } : null;
    }

    formulaLines.push(trimmed);
    if (hasClosingMathFence(trimmed)) {
      const formula = formulaFromFenceLines(formulaLines);
      return formula ? { formula, closeIndex: index } : null;
    }
  }

  return null;
}

function formulaFromFenceLines(lines: string[]): string | null {
  const parts = lines.map((line) => stripClosingMathFence(line.trim())).filter(Boolean);
  if (parts.length === 0 || !parts.every(isLikelyLatexFormulaLine)) return null;
  return normalizePastedFormula(parts.join(" "));
}

const DISPLAY_LATEX_ENVIRONMENTS = new Set([
  "aligned",
  "alignedat",
  "gathered",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "cases",
]);

function latexEnvironmentName(line: string): string | null {
  const match = line.trim().match(/^\\begin\{([A-Za-z*]+)\}/);
  if (!match) return null;

  const environment = match[1];
  return DISPLAY_LATEX_ENVIRONMENTS.has(environment) ? environment : null;
}

function isLatexEnvironmentStart(line: string): boolean {
  return latexEnvironmentName(line) !== null;
}

function latexEnvironmentClosePattern(environment: string): RegExp {
  return new RegExp(`\\\\end\\{${environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`);
}

function collectLatexEnvironment(
  lines: string[],
  openIndex: number
): { formula: string; closeIndex: number } | null {
  const environment = latexEnvironmentName(lines[openIndex] ?? "");
  if (!environment) return null;

  const parts: string[] = [];
  const closePattern = latexEnvironmentClosePattern(environment);

  for (let index = openIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    parts.push(trimmed);

    if (closePattern.test(trimmed)) {
      if (!parts.every(isLikelyLatexFormulaLine)) return null;
      return { formula: normalizePastedFormula(parts.join(" ")), closeIndex: index };
    }
  }

  return null;
}

function protectInlineMathForMarkdown(line: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < line.length) {
    if (line.startsWith("\\(", cursor)) {
      const end = line.indexOf("\\)", cursor + 2);
      if (end !== -1) {
        const formula = line.slice(cursor + 2, end).trim();
        if (formula) {
          result += `\\\\(${escapeMarkdownFormula(formula)}\\\\)`;
          cursor = end + 2;
          continue;
        }
      }
    }

    const char = line[cursor];
    if (char === "(") {
      const end = findClosingParenthesis(line, cursor);
      if (end !== -1) {
        const formula = line.slice(cursor + 1, end).trim();
        if (shouldProtectParenthesizedMath(formula)) {
          result += `(${escapeMarkdownFormula(formula)})`;
          cursor = end + 1;
          continue;
        }
      }
    }

    result += char;
    cursor += 1;
  }

  return result;
}

function findClosingParenthesis(text: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function shouldProtectParenthesizedMath(value: string): boolean {
  if (!value || value.length > 120 || containsProseText(value)) return false;
  if (!/^[A-Za-z0-9\\{}_^=+\-*/.,<>\s()[\]]+$/.test(value)) return false;

  return value.includes("\\") ||
    /[_^=<>]/.test(value) ||
    /^[A-Za-z](?:\([A-Za-z0-9]+\))?$/.test(value) ||
    /^(?:RC|LC)$/.test(value);
}

function escapeMarkdownFormula(value: string): string {
  return value.replace(/([_*`[\]])/g, "\\$1");
}

function normalizePastedFormula(formula: string): string {
  return formula.replace(/\s*={3,}\s*/g, " = ").replace(/\s+/g, " ").trim();
}

function formulaHtmlBlock(formula: string): string {
  return `<figure class="on-formula-block" data-latex="${escapeHtmlAttribute(normalizePastedFormula(formula))}"></figure>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasInlineMarkdownSyntax(text: string): boolean {
  return /(^|[\s([{])(?:\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|_[^_\n]+?_|~~[^~\n]+?~~|`[^`\n]+?`|!?\[[^\]\n]{1,128}\]\(https?:\/\/[^)\s]+[^)]*\))/m.test(text);
}

function isSetextHeadingUnderline(lines: string[], index: number): boolean {
  if (index <= 0) return false;
  const previous = lines[index - 1].trim();
  const current = lines[index].trim();
  return Boolean(previous) && /^(?:=+|-+)$/.test(current);
}

function isStructuredPlainTextPaste(lines: string[]): boolean {
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmptyLines.length < 2) return false;
  if (nonEmptyLines.some((line) => isDocumentSectionHeading(line) || isArrowListLine(line) || isMarkdownLikeLine(line))) {
    return true;
  }
  return nonEmptyLines.length >= 4;
}

function isMarkdownLikeLine(line: string): boolean {
  return /^(#{1,6})\s+/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^[-*]\s+\[[ xX]\]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^```/.test(line) ||
    isMarkdownDividerLine(line);
}

function isDocumentSectionHeading(line: string): boolean {
  return /^(Pagina|Page)\s+\d+\s+[—-]\s+\S/.test(line) || /^Sintesi finale\b/i.test(line);
}

function isArrowListLine(line: string): boolean {
  const arrowIndex = line.indexOf("→");
  if (arrowIndex <= 0) return false;
  return line.slice(0, arrowIndex).trim().length <= 48 && line.slice(arrowIndex + 1).trim().length > 0;
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

    if (isMathInlineContent(item)) {
      const normalizedFormula = normalizePastedFormula(item.props.formula);
      if (normalizedFormula !== item.props.formula) {
        changed = true;
        return [{ ...item, props: { ...item.props, formula: normalizedFormula } }];
      }
      return [item];
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
    content.push({ type: "math", props: { formula: normalizePastedFormula(latexPrefix.formula) } });
    pushText(content, text.slice(latexPrefix.end), styles);

    return { changed: true, content };
  }

  const standaloneFormula = standaloneLatexFormula(text);
  if (standaloneFormula) {
    const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = text.match(/\s*$/)?.[0] ?? "";
    const content: InlineContent[] = [];

    pushText(content, leadingWhitespace, styles);
    content.push({ type: "math", props: { formula: normalizePastedFormula(standaloneFormula) } });
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
    items.push({ type: "math", props: { formula: normalizePastedFormula(formula) } });
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
  if (delimiter === ")") {
    let depth = 1;
    for (let index = startIndex; index < text.length; index += 1) {
      if (text[index] === "(" && text[index - 1] !== "\\") depth += 1;
      if (text[index] === ")" && text[index - 1] !== "\\") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }

    return -1;
  }

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
  return delimiter === "$" ||
    delimiter === "$$" ||
    delimiter === "\\[" ||
    delimiter === "\\(" ||
    shouldProtectParenthesizedMath(formula) ||
    isLikelyLatexFormula(formula);
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
  return /\\(?:oint|int|nabla|vec|overrightarrow|cdot|frac|partial|Sigma|sigma|Gamma|gamma|Delta|delta|Phi|phi|Omega|omega|theta|ell|varepsilon|mathcal|mu|rho|pi|pm|mp|times|div|sqrt|hat|dot|ddot|boxed|left|right|text|sin|cos|tan|qquad|quad|forall|leq|geq|approx)\b/.test(value) ||
    /[_^][{\\\w]/.test(value) ||
    /\\[a-zA-Z]+\{/.test(value);
}

function isMarkdownDividerLine(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, "");
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(compact);
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  let row = trimmed;
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);

  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }

    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell.trim());

  if (cells.length < 2 || cells.every((value) => value === "")) return null;
  return cells;
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function normalizeMarkdownTableRows(rows: string[][]): Array<{ cells: Array<string | InlineContent[]> }> {
  const columnCount = Math.max(...rows.map((row) => row.length));

  return rows.map((row) => ({
    cells: Array.from({ length: columnCount }, (_, index) => {
      const cell = row[index] ?? "";
      return contentFromMarkdownLikeLine(cell);
    }),
  }));
}

function readMarkdownTable(lines: string[], startIndex: number): {
  block: PartialBlock;
  nextIndex: number;
} | null {
  const header = parseMarkdownTableRow(lines[startIndex] ?? "");
  const separator = parseMarkdownTableRow(lines[startIndex + 1] ?? "");

  if (!header || !separator || !isMarkdownTableSeparator(separator)) return null;

  const rows = [header];
  let nextIndex = startIndex + 2;

  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (!trimmed) break;

    const row = parseMarkdownTableRow(lines[nextIndex]);
    if (!row) break;

    rows.push(row);
    nextIndex += 1;
  }

  return {
    block: {
      type: "table",
      content: {
        type: "tableContent",
        rows: normalizeMarkdownTableRows(rows),
      },
    } as unknown as PartialBlock,
    nextIndex,
  };
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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

    const table = readMarkdownTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex - 1;
      continue;
    }

    if (isMarkdownDividerLine(trimmed)) {
      blocks.push({ type: "divider" } as unknown as PartialBlock);
      continue;
    }

    if (isDocumentSectionHeading(trimmed)) {
      blocks.push({
        type: "heading",
        props: { level: 2 },
        content: contentFromMarkdownLikeLine(trimmed),
      } as unknown as PartialBlock);
      continue;
    }

    if (isArrowListLine(trimmed)) {
      blocks.push({
        type: "bulletListItem",
        content: contentFromMarkdownLikeLine(trimmed),
      } as unknown as PartialBlock);
      continue;
    }

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

  while (normalizeFirstBracketedMathGroup(editor, editor.document)) {
    changed = true;
  }

  return changed;
}

function normalizeLatexEnvironmentBlocks(editor: BlockNoteEditor<any, any, any>): boolean {
  let changed = false;

  while (normalizeFirstLatexEnvironmentGroup(editor, editor.document)) {
    changed = true;
  }

  return changed;
}

function normalizeFirstBracketedMathGroup(
  editor: BlockNoteEditor<any, any, any>,
  blocks: Block<any, any, any>[]
): boolean {
  for (let index = 0; index < blocks.length - 2; index += 1) {
    const openBlock = blocks[index];
    const openText = textFromBlockContent(openBlock.content).trim();
    const openFence = openingMathFence(openText);
    if (!openFence) continue;

    const closeIndex = blocks.findIndex((block, candidateIndex) => (
      candidateIndex > index + 1 && hasClosingMathFence(textFromMathBlock(block).trim())
    ));
    if (closeIndex === -1) continue;

    const formulaBlocks = blocks.slice(openFence.hasFormulaContent ? index : index + 1, closeIndex + 1);
    const formulaParts = formulaBlocks.map((block) => {
      const text = textFromMathBlock(block).trim();
      const withoutOpeningFence = block === openBlock ? stripOpeningMathFence(text) : text;
      return stripClosingMathFence(withoutOpeningFence.trim()).replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    if (formulaParts.length === 0 || !formulaParts.every(isLikelyLatexFormulaLine)) continue;

    const formula = normalizePastedFormula(formulaParts.join(" "));
    const targetBlock = openFence.hasFormulaContent ? openBlock : formulaBlocks[0];
    const blocksToRemove = openFence.hasFormulaContent ? formulaBlocks.slice(1) : [openBlock, ...formulaBlocks.slice(1)];
    editor.removeBlocks(blocksToRemove);
    editor.updateBlock(targetBlock, {
      type: "formula",
      props: { formula },
      content: undefined,
    } as never);
    return true;
  }

  for (const block of blocks) {
    if (block.children.length > 0 && normalizeFirstBracketedMathGroup(editor, block.children)) {
      return true;
    }
  }

  return false;
}

function normalizeFirstLatexEnvironmentGroup(
  editor: BlockNoteEditor<any, any, any>,
  blocks: Block<any, any, any>[]
): boolean {
  for (let index = 0; index < blocks.length; index += 1) {
    const openBlock = blocks[index];
    if (openBlock.type === "formula") continue;

    const openText = textFromMathBlock(openBlock).trim();
    const environment = latexEnvironmentName(openText);
    if (!environment) continue;

    const closePattern = latexEnvironmentClosePattern(environment);
    const closeIndex = blocks.findIndex((block, candidateIndex) => (
      candidateIndex >= index && closePattern.test(textFromMathBlock(block).trim())
    ));
    if (closeIndex === -1) continue;

    const formulaParts = blocks.slice(index, closeIndex + 1)
      .map((block) => textFromMathBlock(block).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (formulaParts.length === 0 || !formulaParts.every(isLikelyLatexFormulaLine)) continue;

    const formula = normalizePastedFormula(formulaParts.join(" "));
    const blocksToRemove = blocks.slice(index + 1, closeIndex + 1);
    if (blocksToRemove.length > 0) {
      editor.removeBlocks(blocksToRemove);
    }
    editor.updateBlock(openBlock, {
      type: "formula",
      props: { formula },
      content: undefined,
    } as never);
    return true;
  }

  for (const block of blocks) {
    if (block.children.length > 0 && normalizeFirstLatexEnvironmentGroup(editor, block.children)) {
      return true;
    }
  }

  return false;
}

function openingMathFence(text: string): { hasFormulaContent: boolean } | null {
  if (isOpenMathFence(text)) return { hasFormulaContent: false };
  const stripped = stripOpeningMathFence(text);
  return stripped !== text && stripped.trim().length > 0 ? { hasFormulaContent: true } : null;
}

function isOpenMathFence(text: string): boolean {
  return text === "[" || text === "\\[" || text === "$$";
}

function stripOpeningMathFence(text: string): string {
  const value = text.trim();
  if (value.startsWith("$$")) return value.slice(2).trim();
  if (value.startsWith("\\[")) return value.slice(2).trim();
  if (value.startsWith("[")) return value.slice(1).trim();
  return value;
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
  if (isCompactMathFenceLine(value)) return true;

  return !containsProseText(value) && /[=+\-*/^_\\]/.test(value);
}

function isCompactMathFenceLine(value: string): boolean {
  if (!/^[A-Za-z0-9_{}\\^=+\-*/.,()[\]\s<>|!,]+$/.test(value)) return false;
  if (!/[A-Za-z\\=+\-*/^_{}]/.test(value)) return false;

  const words = value
    .replace(/\\[,;! ]/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .match(/[A-Za-zÀ-ÿ]+/g) ?? [];

  return words.every(isCompactMathWord);
}

const ALLOWED_COMPACT_MATH_WORDS = new Set([
  "alpha",
  "beta",
  "delta",
  "gamma",
  "omega",
  "phi",
  "sigma",
  "theta",
]);

const ALLOWED_PROSE_MATH_WORDS = new Set([
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

function isCompactMathWord(word: string): boolean {
  if (word.length <= 3) return true;

  return ALLOWED_COMPACT_MATH_WORDS.has(word.toLowerCase());
}

function containsProseText(value: string): boolean {
  const withoutLatexSyntax = value
    .replace(/\\text\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}_^\\()[\].,;:=+\-*/\d]/g, " ");
  const proseWords = withoutLatexSyntax.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];

  return proseWords.some((word) => !ALLOWED_PROSE_MATH_WORDS.has(word.toLowerCase()));
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
  // SECURITY: The returned HTML is injected via dangerouslySetInnerHTML in
  // KatexRenderer. The `trust: false` option below is the security boundary —
  // it prevents \href, \url, \includegraphics, etc. from emitting javascript:,
  // data:, or other executable markup. NEVER change to `trust: true` without
  // sanitizing the output with a sanitizer first. The adversarial test in
  // editorMath.test.ts ("renderFormulaHtml XSS regression guard") locks this.
  const normalizedFormula = normalizeFormulaForKatex(formula || "\\?");
  if (normalizedFormula.length > MAX_FORMULA_LENGTH) {
    return renderFormulaErrorHtml("Formula too long");
  }

  try {
    return katex.renderToString(normalizedFormula, {
      throwOnError: false,
      strict: false,
      output: "html",
      displayMode,
      macros: KATEX_MACROS,
      maxSize: KATEX_MAX_SIZE,
      maxExpand: KATEX_MAX_EXPAND,
      trust: false,
    });
  } catch {
    return renderFormulaErrorHtml("Formula cannot be rendered");
  }
}

function renderFormulaErrorHtml(message: string): string {
  return `<span class="katex-error" title="${escapeFormulaHtml(message)}">${escapeFormulaHtml(message)}</span>`;
}

function escapeFormulaHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeFormulaForKatex(formula: string): string {
  const strippedFormula = normalizePastedFormula(stripFormulaDelimiters(formula));

  return strippedFormula
    .replace(/\$\$/g, " ")
    .replace(/\$/g, " ")
    .replace(/[^\x00-\x7F]/g, " ")
    .replace(/\\(?=\s*(?:\n|$))/g, " ")
    .replace(/\\Delta\s+V\s*\{([A-Za-z]{2})\}/g, "\\Delta V_{$1}")
    .replace(/\bV\s*\{([A-Za-z]{2})\}/g, "V_{$1}")
    .replace(/\bV([A-Z])\b/g, "V_$1")
    .replace(/\bR\s*\{\s*eq\s*\}/g, "R_{eq}")
    .replace(/\bR\s+([0-9]+)\b/g, "R_$1")
    .replace(/\bR([0-9]+)\b/g, "R_$1")
    .replace(/\\(sin|cos|tan)(theta|phi|alpha|beta|gamma|omega)\b/g, (_match, fn, variable) => `\\${fn}\\${variable}`)
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
