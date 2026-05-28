import { describe, expect, it } from "vitest";
import {
  blocksFromPastedMathText,
  formulaFromBlockContent,
  formulaSlashMenuItem,
  normalizeMathInlineContent,
  normalizeMathInlineContentInEditor,
  openNotionEditorSchema,
  renderFormulaHtml,
} from "./editorMath";

describe("normalizeMathInlineContent", () => {
  it("converts dollar-delimited formulas into inline math content", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "Gauss: $\\nabla \\cdot \\vec{E}$ ok", styles: {} },
      ]).content
    ).toEqual([
      { type: "text", text: "Gauss: ", styles: {} },
      { type: "math", props: { formula: "\\nabla \\cdot \\vec{E}" } },
      { type: "text", text: " ok", styles: {} },
    ]);
  });

  it("leaves incomplete formulas as text", () => {
    const content = [{ type: "text", text: "Price is $5", styles: {} }];
    expect(normalizeMathInlineContent(content).content).toEqual(content);
  });

  it("converts bracket-delimited latex formulas", () => {
    expect(
      normalizeMathInlineContent([
        {
          type: "text",
          text: "In forma integrale: [\\oint{\\Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q{\\text{int}}}{\\varepsilon_0}]",
          styles: {},
        },
      ]).content
    ).toEqual([
      { type: "text", text: "In forma integrale: ", styles: {} },
      {
        type: "math",
        props: {
          formula: "\\oint{\\Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q{\\text{int}}}{\\varepsilon_0}",
        },
      },
    ]);
  });

  it("converts parenthesized latex terms inside explanatory text", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "(\\vec{E}) è il campo elettrico", styles: {} },
      ]).content
    ).toEqual([
      { type: "math", props: { formula: "\\vec{E}" } },
      { type: "text", text: " è il campo elettrico", styles: {} },
    ]);
  });

  it("does not convert latex-prefixed prose into one math formula", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "\\varepsilon_0 è la costante dielettrica del vuoto.", styles: {} },
      ]).content
    ).toEqual([
      { type: "math", props: { formula: "\\varepsilon_0" } },
      { type: "text", text: " è la costante dielettrica del vuoto.", styles: {} },
    ]);
  });

  it("converts a standalone latex command line", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}", styles: {} },
      ]).content
    ).toEqual([
      { type: "math", props: { formula: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}" } },
    ]);
  });

  it("does not treat ordinary square brackets as math", () => {
    const content = [{ type: "text", text: "Read [chapter one] first", styles: {} }];
    expect(normalizeMathInlineContent(content).content).toEqual(content);
  });
});

describe("blocksFromPastedMathText", () => {
  it("turns display math fences into formula blocks and keeps prose paragraphs", () => {
    expect(
      blocksFromPastedMathText(
        "cioè:\n$$\n\\vec{F}\nq_2\n\\left(\n\\frac{1}{4\\pi\\varepsilon_0}\n\\frac{q_1}{r^2}\n\\hat{r}\n\\right)\n$$"
      )
    ).toEqual([
      { type: "paragraph", content: "cioè:" },
      {
        type: "formula",
        props: {
          formula: "\\vec{F} q_2 \\left( \\frac{1}{4\\pi\\varepsilon_0} \\frac{q_1}{r^2} \\hat{r} \\right)",
        },
      },
    ]);
  });

  it("turns one-line display math fences into a formula block", () => {
    expect(blocksFromPastedMathText("$$q = \\pm Ne$$")).toEqual([
      {
        type: "formula",
        props: { formula: "q = \\pm Ne" },
      },
    ]);
  });
});

describe("openNotionEditorSchema", () => {
  it("registers a dedicated formula block", () => {
    expect(openNotionEditorSchema.blockSchema.formula).toMatchObject({
      type: "formula",
      content: "none",
    });
  });
});

describe("renderFormulaHtml", () => {
  it("renders display math with KaTeX display markup", () => {
    expect(renderFormulaHtml("\\int_0^1 x dx", true)).toContain("katex-display");
  });
});

describe("formulaSlashMenuItem", () => {
  it("inserts a formula block from the slash menu", () => {
    const currentBlock = { id: "current", type: "paragraph", content: [], children: [] };
    const calls: unknown[] = [];
    const editor = {
      schema: { blockSchema: { paragraph: { content: "inline" }, formula: { content: "none" } } },
      getTextCursorPosition: () => ({ block: currentBlock }),
      updateBlock: (_block: unknown, update: unknown) => {
        calls.push(update);
        return { ...currentBlock, ...(update as object) };
      },
      setTextCursorPosition: () => {},
    };

    const item = formulaSlashMenuItem(editor as never);

    expect(item.title).toBe("Formula");
    expect(item.aliases).toContain("formula");

    item.onItemClick();

    expect(calls).toEqual([{ type: "formula", props: { formula: "\\nabla \\cdot \\vec{E}" } }]);
  });
});

describe("formulaFromBlockContent", () => {
  it("extracts bracketed formulas from paragraph content", () => {
    expect(
      formulaFromBlockContent([
        {
          type: "text",
          text: "[\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}]",
          styles: {},
        },
      ])
    ).toBe("\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}");
  });

  it("extracts one-line display formulas with short variable names", () => {
    expect(
      formulaFromBlockContent([
        {
          type: "text",
          text: "$$q = \\pm Ne$$",
          styles: {},
        },
      ])
    ).toBe("q = \\pm Ne");
  });
});

describe("normalizeMathInlineContentInEditor", () => {
  it("normalizes single-block bracket formulas into formula blocks", () => {
    const document = [
      {
        id: "formula",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "[\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}]",
            styles: {},
          },
        ],
        children: [],
      },
    ];
    const editor = {
      document,
      removeBlocks() {},
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document[0]).toEqual({
      id: "formula",
      type: "formula",
      props: { formula: "\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}" },
      content: undefined,
      children: [],
    });
  });
});

describe("normalizeMathInlineContentInEditor", () => {
  it("normalizes existing bracket blocks into formula blocks on page load", () => {
    const document = [
      { id: "open", type: "paragraph", content: [{ type: "text", text: "[", styles: {} }], children: [] },
      {
        id: "formula",
        type: "paragraph",
        content: [{ type: "text", text: "\\nabla \\cdot \\vec{B}=0", styles: {} }],
        children: [],
      },
      { id: "close", type: "paragraph", content: [{ type: "text", text: "]", styles: {} }], children: [] },
    ];
    const editor = {
      document,
      removeBlocks(blocks: Array<{ id: string }>) {
        const ids = new Set(blocks.map((block) => block.id));
        for (let index = document.length - 1; index >= 0; index -= 1) {
          if (ids.has(document[index].id)) document.splice(index, 1);
        }
      },
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document).toEqual([
      {
        id: "formula",
        type: "formula",
        props: { formula: "\\nabla \\cdot \\vec{B}=0" },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes multi-line bracket formulas with split derivative terms", () => {
    const document = [
      { id: "open", type: "paragraph", content: [{ type: "text", text: "[", styles: {} }], children: [] },
      {
        id: "formula-symbol",
        type: "paragraph",
        content: [{ type: "text", text: "\\mathcal{E}", styles: {} }],
        children: [],
      },
      {
        id: "formula-derivative",
        type: "paragraph",
        content: [{ type: "text", text: "-\\frac{d\\Phi_B}{dt}", styles: {} }],
        children: [],
      },
      { id: "close", type: "paragraph", content: [{ type: "text", text: "]", styles: {} }], children: [] },
    ];
    const editor = {
      document,
      removeBlocks(blocks: Array<{ id: string }>) {
        const ids = new Set(blocks.map((block) => block.id));
        for (let index = document.length - 1; index >= 0; index -= 1) {
          if (ids.has(document[index].id)) document.splice(index, 1);
        }
      },
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document).toEqual([
      {
        id: "formula-symbol",
        type: "formula",
        props: { formula: "\\mathcal{E} -\\frac{d\\Phi_B}{dt}" },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes pasted display math fences with multi-line formulas", () => {
    const document = [
      { id: "before", type: "paragraph", content: [{ type: "text", text: "cioè:", styles: {} }], children: [] },
      { id: "open", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      {
        id: "force",
        type: "paragraph",
        content: [{ type: "text", text: "\\vec{F}", styles: {} }],
        children: [],
      },
      {
        id: "charge",
        type: "paragraph",
        content: [{ type: "text", text: "q_2", styles: {} }],
        children: [],
      },
      {
        id: "left",
        type: "paragraph",
        content: [{ type: "text", text: "\\left(", styles: {} }],
        children: [],
      },
      {
        id: "coulomb",
        type: "paragraph",
        content: [{ type: "text", text: "\\frac{1}{4\\pi\\varepsilon_0}", styles: {} }],
        children: [],
      },
      {
        id: "source",
        type: "paragraph",
        content: [{ type: "text", text: "\\frac{q_1}{r^2}", styles: {} }],
        children: [],
      },
      {
        id: "direction",
        type: "paragraph",
        content: [{ type: "text", text: "\\hat{r}", styles: {} }],
        children: [],
      },
      {
        id: "right",
        type: "paragraph",
        content: [{ type: "text", text: "\\right)", styles: {} }],
        children: [],
      },
      { id: "close", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
    ];
    const editor = {
      document,
      removeBlocks(blocks: Array<{ id: string }>) {
        const ids = new Set(blocks.map((block) => block.id));
        for (let index = document.length - 1; index >= 0; index -= 1) {
          if (ids.has(document[index].id)) document.splice(index, 1);
        }
      },
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document).toEqual([
      { id: "before", type: "paragraph", content: [{ type: "text", text: "cioè:", styles: {} }], children: [] },
      {
        id: "force",
        type: "formula",
        props: {
          formula: "\\vec{F} q_2 \\left( \\frac{1}{4\\pi\\varepsilon_0} \\frac{q_1}{r^2} \\hat{r} \\right)",
        },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes bracket formulas when the first line was already inline math", () => {
    const document = [
      { id: "open", type: "paragraph", content: [{ type: "text", text: "[", styles: {} }], children: [] },
      {
        id: "formula-start",
        type: "paragraph",
        content: [{ type: "math", props: { formula: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}" } }],
        children: [],
      },
      {
        id: "formula-operator",
        type: "paragraph",
        content: [{ type: "text", text: "-\\frac{d}{dt}", styles: {} }],
        children: [],
      },
      {
        id: "formula-integral",
        type: "paragraph",
        content: [{ type: "text", text: "\\int_{\\Sigma}", styles: {} }],
        children: [],
      },
      {
        id: "formula-end",
        type: "paragraph",
        content: [{ type: "text", text: "\\vec{B}\\cdot d\\vec{S}", styles: {} }],
        children: [],
      },
      { id: "close", type: "paragraph", content: [{ type: "text", text: "]", styles: {} }], children: [] },
    ];
    const editor = {
      document,
      removeBlocks(blocks: Array<{ id: string }>) {
        const ids = new Set(blocks.map((block) => block.id));
        for (let index = document.length - 1; index >= 0; index -= 1) {
          if (ids.has(document[index].id)) document.splice(index, 1);
        }
      },
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document).toEqual([
      {
        id: "formula-start",
        type: "formula",
        props: {
          formula: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l} -\\frac{d}{dt} \\int_{\\Sigma} \\vec{B}\\cdot d\\vec{S}",
        },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes bracket formulas when the closing fence is attached to the final formula line", () => {
    const document = [
      { id: "open", type: "paragraph", content: [{ type: "text", text: "[", styles: {} }], children: [] },
      {
        id: "formula-left",
        type: "paragraph",
        content: [{ type: "math", props: { formula: "\\oint_{\\Sigma} \\vec{E}\\cdot d\\vec{S}" } }],
        children: [],
      },
      {
        id: "formula-right",
        type: "paragraph",
        content: [{ type: "text", text: "\\frac{Q\\text{int}}{\\varepsilon_0}]", styles: {} }],
        children: [],
      },
    ];
    const editor = {
      document,
      removeBlocks(blocks: Array<{ id: string }>) {
        const ids = new Set(blocks.map((block) => block.id));
        for (let index = document.length - 1; index >= 0; index -= 1) {
          if (ids.has(document[index].id)) document.splice(index, 1);
        }
      },
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document).toEqual([
      {
        id: "formula-left",
        type: "formula",
        props: { formula: "\\oint_{\\Sigma} \\vec{E}\\cdot d\\vec{S} \\frac{Q\\text{int}}{\\varepsilon_0}" },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes latex text nested in table-like content", () => {
    const document = [
      {
        id: "table",
        type: "table",
        content: {
          rows: [
            {
              cells: [
                [{ type: "text", text: "Gauss per (\\vec{E})", styles: {} }],
                [{ type: "text", text: "(\\oint \\vec{E}\\cdot d\\vec{S} = \\frac{Q}{\\varepsilon_0})", styles: {} }],
              ],
            },
          ],
        },
        children: [],
      },
    ];
    const editor = {
      document,
      removeBlocks() {},
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document[0].content).toEqual({
      rows: [
        {
          cells: [
            [
              { type: "text", text: "Gauss per ", styles: {} },
              { type: "math", props: { formula: "\\vec{E}" } },
            ],
            [
              {
                type: "math",
                props: { formula: "\\oint \\vec{E}\\cdot d\\vec{S} = \\frac{Q}{\\varepsilon_0}" },
              },
            ],
          ],
        },
      ],
    });
  });

  it("normalizes table formulas with a missing closing parenthesis", () => {
    expect(
      normalizeMathInlineContent([
        {
          type: "text",
          text: "(\\oint \\vec{E}\\cdot d\\vec{S} = \\frac{Q{\\text{int}}}{\\varepsilon0}",
          styles: {},
        },
      ]).content
    ).toEqual([
      {
        type: "math",
        props: { formula: "\\oint \\vec{E}\\cdot d\\vec{S} = \\frac{Q{\\text{int}}}{\\varepsilon0}" },
      },
    ]);
  });

  it("normalizes pasted standalone math headings into formula blocks", () => {
    const document = [
      {
        id: "formula",
        type: "heading",
        content: [{ type: "text", text: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}", styles: {} }],
        children: [],
      },
    ];
    const editor = {
      document,
      removeBlocks() {},
      updateBlock(block: { id: string }, update: Record<string, unknown>) {
        Object.assign(document.find((item) => item.id === block.id)!, update);
      },
    };

    expect(normalizeMathInlineContentInEditor(editor as never)).toBe(true);
    expect(document[0]).toEqual({
      id: "formula",
      type: "formula",
      props: { formula: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}" },
      content: undefined,
      children: [],
    });
  });
});
