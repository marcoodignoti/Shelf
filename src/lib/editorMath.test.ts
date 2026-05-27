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
});
