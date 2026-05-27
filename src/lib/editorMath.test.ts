import { describe, expect, it } from "vitest";
import { normalizeMathInlineContent, normalizeMathInlineContentInEditor } from "./editorMath";

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

describe("normalizeMathInlineContentInEditor", () => {
  it("normalizes existing bracket blocks on page load", () => {
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
        type: "paragraph",
        content: [{ type: "math", props: { formula: "\\nabla \\cdot \\vec{B}=0" } }],
        children: [],
      },
    ]);
  });

  it("downgrades pasted standalone math headings to paragraphs", () => {
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
      type: "paragraph",
      content: [{ type: "math", props: { formula: "\\oint_{\\Gamma} \\vec{E}\\cdot d\\vec{l}" } }],
      children: [],
    });
  });
});
