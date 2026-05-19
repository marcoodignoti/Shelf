import { describe, expect, it } from "vitest";
import { pageContentPreview, pageContentToSearchText, parsePageBlocks } from "./pageContent";

describe("parsePageBlocks", () => {
  it("returns an empty paragraph for empty content", () => {
    expect(parsePageBlocks(null)).toEqual([{ type: "paragraph" }]);
    expect(parsePageBlocks("")).toEqual([{ type: "paragraph" }]);
  });

  it("converts plain text content into paragraph blocks", () => {
    expect(parsePageBlocks("one\ntwo")).toEqual([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
    ]);
  });

  it("converts legacy plainText JSON into paragraph blocks", () => {
    expect(parsePageBlocks(JSON.stringify({ plainText: "legacy" }))).toEqual([
      { type: "paragraph", content: "legacy" },
    ]);
  });

  it("keeps valid persisted BlockNote blocks", () => {
    const block = {
      id: "block-1",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "hello", styles: {} }],
      children: [],
    };

    expect(parsePageBlocks(JSON.stringify([block]))).toEqual([block]);
  });

  it("drops malformed persisted block entries", () => {
    const validBlock = { type: "paragraph", content: "valid" };

    expect(parsePageBlocks(JSON.stringify([null, [], "bad", validBlock]))).toEqual([validBlock]);
    expect(parsePageBlocks(JSON.stringify([null, [], "bad"]))).toEqual([{ type: "paragraph" }]);
  });
});

describe("pageContentToSearchText", () => {
  it("extracts readable text from persisted BlockNote JSON", () => {
    const content = JSON.stringify([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Alpha", styles: {} },
          { type: "text", text: "Beta", styles: {} },
        ],
        children: [
          {
            type: "bulletListItem",
            content: "Nested item",
            children: [],
          },
        ],
      },
      {
        type: "heading",
        content: "Roadmap",
        children: [],
      },
    ]);

    expect(pageContentToSearchText(content)).toBe("Alpha Beta Nested item Roadmap");
  });

  it("keeps legacy plain text searchable", () => {
    expect(pageContentToSearchText("one\ntwo")).toBe("one two");
    expect(pageContentToSearchText(JSON.stringify({ plainText: "legacy note" }))).toBe("legacy note");
  });

  it("extracts readable text from persisted table cells", () => {
    const content = JSON.stringify([
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: ["Name", "Status"],
            },
            {
              cells: [
                [{ type: "text", text: "Launch plan", styles: {} }],
                "Ready",
              ],
            },
          ],
        },
        children: [],
      },
    ]);

    expect(pageContentToSearchText(content)).toBe("Name Status Launch plan Ready");
  });
});

describe("pageContentPreview", () => {
  it("returns a clean snippet around the query", () => {
    expect(pageContentPreview("Alpha Beta Gamma Delta", "Gamma")).toBe("Alpha Beta Gamma Delta");
    expect(pageContentPreview(null, "Gamma")).toBeNull();
    expect(pageContentPreview("Alpha Beta Gamma Delta", "   ")).toBeNull();
  });
});
