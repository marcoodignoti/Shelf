import { describe, expect, it } from "vitest";
import {
  blocksFromPastedMathText,
  formulaFromBlockContent,
  formulaSlashMenuItem,
  MAX_FORMULA_LENGTH,
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

  it("keeps dollar delimiters ahead of raw latex expression detection", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "Valore: $d = 1 \\text{ mm}$ ok", styles: {} },
      ]).content
    ).toEqual([
      { type: "text", text: "Valore: ", styles: {} },
      { type: "math", props: { formula: "d = 1 \\text{ mm}" } },
      { type: "text", text: " ok", styles: {} },
    ]);
  });

  it("converts explicit ChatGPT inline latex delimiters with simple variables", () => {
    expect(
      normalizeMathInlineContent([
        { type: "text", text: "Corrente maggiore dove \\(R\\) è minore.", styles: {} },
      ]).content
    ).toEqual([
      { type: "text", text: "Corrente maggiore dove ", styles: {} },
      { type: "math", props: { formula: "R" } },
      { type: "text", text: " è minore.", styles: {} },
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

  it("converts latex expressions embedded in prose without dollar delimiters", () => {
    expect(
      normalizeMathInlineContent([
        {
          type: "text",
          text: "N.B. filo di rame di diametro d = 1 \\text{ mm} e lunghezza \\ell = 1 \\text{ cm}:",
          styles: {},
        },
      ]).content
    ).toEqual([
      { type: "text", text: "N.B. filo di rame di diametro ", styles: {} },
      { type: "math", props: { formula: "d = 1 \\text{ mm}" } },
      { type: "text", text: " e lunghezza ", styles: {} },
      { type: "math", props: { formula: "\\ell = 1 \\text{ cm}" } },
      { type: "text", text: ":", styles: {} },
    ]);
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

  it("keeps variable-only lines inside display math fences", () => {
    expect(
      blocksFromPastedMathText(
        "Potenza spesa:\n$$\nP\n=\nR_1 i_1^2\n+\nR_2 i_2^2\n=\n\\Delta V_{AB}^2\n\\left(\n\\frac{1}{R_1}\n+\n\\frac{1}{R_2}\n\\right)\n=\n\\frac{\\Delta V_{AB}^2}{R_{eq}}\n$$"
      )
    ).toEqual([
      { type: "paragraph", content: "Potenza spesa:" },
      {
        type: "formula",
        props: {
          formula: "P = R_1 i_1^2 + R_2 i_2^2 = \\Delta V_{AB}^2 \\left( \\frac{1}{R_1} + \\frac{1}{R_2} \\right) = \\frac{\\Delta V_{AB}^2}{R_{eq}}",
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

  it("preserves ChatGPT-style markdown blocks around display math fences", () => {
    expect(
      blocksFromPastedMathText(
        [
          "## Regole rapide",
          "",
          "- Corrente maggiore dove \\(R\\) è minore.",
          "- Equivalente: \\(R_{eq} < R_i\\).",
          "",
          "```text",
          "R = 2 \\cdot 10^{-4}\\ \\Omega",
          "```",
          "",
          "$$",
          "P",
          "=",
          "R_1 i_1^2",
          "+",
          "R_2 i_2^2",
          "$$",
        ].join("\n")
      )
    ).toEqual([
      { type: "heading", props: { level: 2 }, content: "Regole rapide" },
      {
        type: "bulletListItem",
        content: [
          { type: "text", text: "Corrente maggiore dove ", styles: {} },
          { type: "math", props: { formula: "R" } },
          { type: "text", text: " è minore.", styles: {} },
        ],
      },
      {
        type: "bulletListItem",
        content: [
          { type: "text", text: "Equivalente: ", styles: {} },
          { type: "math", props: { formula: "R_{eq} < R_i" } },
          { type: "text", text: ".", styles: {} },
        ],
      },
      { type: "codeBlock", props: { language: "text" }, content: "R = 2 \\cdot 10^{-4}\\ \\Omega" },
      {
        type: "formula",
        props: { formula: "P = R_1 i_1^2 + R_2 i_2^2" },
      },
    ]);
  });

  it("structures long plain-text lesson summaries into headings and paragraphs", () => {
    expect(
      blocksFromPastedMathText(
        [
          "Di seguito trovi il riassunto pagina per pagina della lezione ESE_L05_20240313_14_16.pdf.",
          "Pagina 1 — Copertina della V lezione",
          "La prima slide è la copertina della quinta lezione.",
          "Pagina 2 — ATmel: Programming Model, Instruction Set, Addressing Modes",
          "La seconda slide riprende i tre elementi fondamentali dell’interfaccia tra CPU e programmatore.",
          "R → cadute di tensione e dissipazione",
          "Sintesi finale della lezione",
          "Questa quinta lezione chiude il passaggio dal modello logico della CPU al comportamento elettrico reale.",
        ].join("\n")
      )
    ).toEqual([
      { type: "paragraph", content: "Di seguito trovi il riassunto pagina per pagina della lezione ESE_L05_20240313_14_16.pdf." },
      { type: "heading", props: { level: 2 }, content: "Pagina 1 — Copertina della V lezione" },
      { type: "paragraph", content: "La prima slide è la copertina della quinta lezione." },
      { type: "heading", props: { level: 2 }, content: "Pagina 2 — ATmel: Programming Model, Instruction Set, Addressing Modes" },
      { type: "paragraph", content: "La seconda slide riprende i tre elementi fondamentali dell’interfaccia tra CPU e programmatore." },
      { type: "bulletListItem", content: "R → cadute di tensione e dissipazione" },
      { type: "heading", props: { level: 2 }, content: "Sintesi finale della lezione" },
      { type: "paragraph", content: "Questa quinta lezione chiude il passaggio dal modello logico della CPU al comportamento elettrico reale." },
    ]);
  });

  it("keeps compact product symbols inside display math fences", () => {
    expect(
      blocksFromPastedMathText(
        [
          "In modulo:",
          "$$",
          "F",
          "=",
          "qvB\\sintheta",
          "=",
          "qv_nB",
          "$$",
        ].join("\n")
      )
    ).toEqual([
      { type: "paragraph", content: "In modulo:" },
      {
        type: "formula",
        props: { formula: "F = qvB\\sintheta = qv_nB" },
      },
    ]);
  });

  it("keeps boxed multiline formulas with compact denominator symbols", () => {
    expect(
      blocksFromPastedMathText(
        [
          "$$",
          "\\boxed{",
          "v_p T",
          "=",
          "\\frac{2\\pi m v \\cos\\theta}",
          "{qB}",
          "}",
          "$$",
        ].join("\n")
      )
    ).toEqual([
      {
        type: "formula",
        props: { formula: "\\boxed{ v_p T = \\frac{2\\pi m v \\cos\\theta} {qB} }" },
      },
    ]);
  });

  it("keeps boxed vector integral formulas inside display math fences", () => {
    expect(
      blocksFromPastedMathText(
        [
          "si ottiene:",
          "$$",
          "\\boxed{",
          "d\\vec{F}",
          "=",
          "i,d\\vec{s}\\times\\vec{B}",
          "}",
          "$$",
        ].join("\n")
      )
    ).toEqual([
      { type: "paragraph", content: "si ottiene:" },
      {
        type: "formula",
        props: { formula: "\\boxed{ d\\vec{F} = i,d\\vec{s}\\times\\vec{B} }" },
      },
    ]);
  });

  it("keeps compact work differential symbols inside display math fences", () => {
    expect(blocksFromPastedMathText("e:\n$$\nM,d\\theta\n=\ndW\n$$")).toEqual([
      { type: "paragraph", content: "e:" },
      {
        type: "formula",
        props: { formula: "M,d\\theta = dW" },
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

  it("renders pasted resistor zigzag macros without showing raw latex errors", () => {
    const html = renderFormulaHtml("\\text{---}!!\\zigzag!!\\text{---}", true);

    expect(html).not.toContain("\\zigzag");
    expect(html).not.toContain("!!");
    expect(html).not.toContain("color:#cc0000");
  });

  it("renders formula blocks even when pasted with display math delimiters", () => {
    const html = renderFormulaHtml("$$R_{eq} < R_i\\qquad \\forall i", true);

    expect(html).not.toContain("$$");
    expect(html).not.toContain("\\qquad");
    expect(html).not.toContain("\\forall");
    expect(html).not.toContain("color:#cc0000");
  });

  it("renders ChatGPT shorthand trig commands pasted without command boundaries", () => {
    const html = renderFormulaHtml("qvB\\sintheta = qv_nB", true);

    expect(html).not.toContain("\\sintheta");
    expect(html).not.toContain("color:#cc0000");
  });

  it("renders common boxed vector mechanics formulas without raw latex errors", () => {
    for (const formula of [
      "\\boxed{ \\ddot{\\theta} + \\omega^2\\theta = 0 }",
      "\\boxed{ \\vec{M} = \\vec{m}\\times\\vec{B} }",
      "\\boxed{ d\\vec{F} = i,d\\vec{s}\\times\\vec{B} }",
      "\\int_P^Q d\\vec{s}\\times\\vec{B}",
    ]) {
      const html = renderFormulaHtml(formula, true);

      expect(html).not.toContain("color:#cc0000");
    }
  });

  it("rejects formulas above the render length cap", () => {
    const html = renderFormulaHtml("x".repeat(MAX_FORMULA_LENGTH + 1), true);

    expect(html).toContain("Formula too long");
    expect(html).not.toContain("x".repeat(128));
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

  it("extracts standalone formulas that start with a variable", () => {
    expect(
      formulaFromBlockContent([
        {
          type: "text",
          text: "R = 2 \\cdot 10^{-4}\\ \\Omega",
          styles: {},
        },
      ])
    ).toBe("R = 2 \\cdot 10^{-4}\\ \\Omega");
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

  it("normalizes display math fences with variable-only lines on page load", () => {
    const document = [
      { id: "before", type: "paragraph", content: [{ type: "text", text: "Potenza spesa:", styles: {} }], children: [] },
      { id: "open", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "power", type: "paragraph", content: [{ type: "text", text: "P", styles: {} }], children: [] },
      { id: "equals-start", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "first", type: "paragraph", content: [{ type: "text", text: "R_1 i_1^2", styles: {} }], children: [] },
      { id: "plus-first", type: "paragraph", content: [{ type: "text", text: "+", styles: {} }], children: [] },
      { id: "second", type: "paragraph", content: [{ type: "text", text: "R_2 i_2^2", styles: {} }], children: [] },
      { id: "equals-mid", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "delta", type: "paragraph", content: [{ type: "text", text: "\\Delta V_{AB}^2", styles: {} }], children: [] },
      { id: "left", type: "paragraph", content: [{ type: "text", text: "\\left(", styles: {} }], children: [] },
      { id: "conductance-one", type: "paragraph", content: [{ type: "text", text: "\\frac{1}{R_1}", styles: {} }], children: [] },
      { id: "plus-second", type: "paragraph", content: [{ type: "text", text: "+", styles: {} }], children: [] },
      { id: "conductance-two", type: "paragraph", content: [{ type: "text", text: "\\frac{1}{R_2}", styles: {} }], children: [] },
      { id: "right", type: "paragraph", content: [{ type: "text", text: "\\right)", styles: {} }], children: [] },
      { id: "equals-end", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "equivalent", type: "paragraph", content: [{ type: "text", text: "\\frac{\\Delta V_{AB}^2}{R_{eq}}", styles: {} }], children: [] },
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
      { id: "before", type: "paragraph", content: [{ type: "text", text: "Potenza spesa:", styles: {} }], children: [] },
      {
        id: "power",
        type: "formula",
        props: {
          formula: "P = R_1 i_1^2 + R_2 i_2^2 = \\Delta V_{AB}^2 \\left( \\frac{1}{R_1} + \\frac{1}{R_2} \\right) = \\frac{\\Delta V_{AB}^2}{R_{eq}}",
        },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes display math fences with compact product symbols on page load", () => {
    const document = [
      { id: "before", type: "paragraph", content: [{ type: "text", text: "In modulo:", styles: {} }], children: [] },
      { id: "open", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "force", type: "paragraph", content: [{ type: "text", text: "F", styles: {} }], children: [] },
      { id: "equals-start", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "lorentz", type: "paragraph", content: [{ type: "text", text: "qvB\\sintheta", styles: {} }], children: [] },
      { id: "equals-end", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "normal", type: "paragraph", content: [{ type: "text", text: "qv_nB", styles: {} }], children: [] },
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
      { id: "before", type: "paragraph", content: [{ type: "text", text: "In modulo:", styles: {} }], children: [] },
      {
        id: "force",
        type: "formula",
        props: { formula: "F = qvB\\sintheta = qv_nB" },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes every display math fence group on page load", () => {
    const document = [
      { id: "open-first", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "force", type: "paragraph", content: [{ type: "text", text: "F", styles: {} }], children: [] },
      { id: "equals-first", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "lorentz", type: "paragraph", content: [{ type: "text", text: "qvB\\sintheta", styles: {} }], children: [] },
      { id: "close-first", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "between", type: "paragraph", content: [{ type: "text", text: "quindi:", styles: {} }], children: [] },
      { id: "open-second", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "moment", type: "paragraph", content: [{ type: "text", text: "M", styles: {} }], children: [] },
      { id: "equals-second", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "work", type: "paragraph", content: [{ type: "text", text: "ia b B\\sin\\theta", styles: {} }], children: [] },
      { id: "close-second", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
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
        id: "force",
        type: "formula",
        props: { formula: "F = qvB\\sintheta" },
        content: undefined,
        children: [],
      },
      { id: "between", type: "paragraph", content: [{ type: "text", text: "quindi:", styles: {} }], children: [] },
      {
        id: "moment",
        type: "formula",
        props: { formula: "M = ia b B\\sin\\theta" },
        content: undefined,
        children: [],
      },
    ]);
  });

  it("normalizes pre-existing display math fences attached to formula lines", () => {
    const document = [
      { id: "before", type: "paragraph", content: [{ type: "text", text: "si ottiene:", styles: {} }], children: [] },
      { id: "open", type: "paragraph", content: [{ type: "text", text: "$$\n\\boxed{", styles: {} }], children: [] },
      { id: "force", type: "heading", content: [{ type: "text", text: "d\\vec{F}", styles: {} }], children: [] },
      {
        id: "body",
        type: "paragraph",
        content: [{ type: "text", text: "i,d\\vec{s}\\times\\vec{B}\n}\n$$", styles: {} }],
        children: [],
      },
      { id: "after", type: "paragraph", content: [{ type: "text", text: "Questa è la seconda legge.", styles: {} }], children: [] },
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
      { id: "before", type: "paragraph", content: [{ type: "text", text: "si ottiene:", styles: {} }], children: [] },
      {
        id: "open",
        type: "formula",
        props: { formula: "\\boxed{ d\\vec{F} i,d\\vec{s}\\times\\vec{B} }" },
        content: undefined,
        children: [],
      },
      { id: "after", type: "paragraph", content: [{ type: "text", text: "Questa è la seconda legge.", styles: {} }], children: [] },
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
