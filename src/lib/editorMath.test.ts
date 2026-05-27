import { describe, expect, it } from "vitest";
import { normalizeMathInlineContent } from "./editorMath";

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
