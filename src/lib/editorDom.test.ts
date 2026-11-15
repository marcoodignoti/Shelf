// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Block } from "@blocknote/core";
import {
  blockElementSelector,
  disableSpellcheck,
  headingItemsFromBlocks,
  isEmptyEditorBlock,
  isNativeTextInput,
  textFromInlineContent,
} from "./editorDom";

type AnyBlock = Block<any, any, any>;

function block(partial: Partial<AnyBlock> & { id: string }): AnyBlock {
  return {
    type: "paragraph",
    props: {},
    content: [],
    children: [],
    ...partial,
  } as AnyBlock;
}

describe("textFromInlineContent", () => {
  it("joins text and inline formulas with collapsed whitespace", () => {
    expect(
      textFromInlineContent([
        { type: "text", text: "Energy  is ", styles: {} },
        { type: "inlineMath", props: { formula: "E=mc^2" } },
        "  and\nmore ",
      ]),
    ).toBe("Energy is E=mc^2 and more");
  });

  it("returns plain strings unchanged and ignores unknown shapes", () => {
    expect(textFromInlineContent("raw")).toBe("raw");
    expect(textFromInlineContent(undefined)).toBe("");
    expect(textFromInlineContent({ text: "not an array" })).toBe("");
    expect(textFromInlineContent([null, 3, [], { type: "link" }, { props: null }])).toBe("");
  });
});

describe("isEmptyEditorBlock", () => {
  it("treats whitespace-only and missing content as empty", () => {
    expect(isEmptyEditorBlock(block({ id: "a" }))).toBe(true);
    expect(isEmptyEditorBlock(block({ id: "b", content: undefined }))).toBe(true);
    expect(isEmptyEditorBlock(block({ id: "c", content: [{ type: "text", text: "   ", styles: {} }] }))).toBe(true);
    expect(isEmptyEditorBlock(block({ id: "d", content: "  " as never }))).toBe(true);
  });

  it("treats text or children as non-empty", () => {
    expect(isEmptyEditorBlock(block({ id: "a", content: [{ type: "text", text: "x", styles: {} }] }))).toBe(false);
    expect(isEmptyEditorBlock(block({ id: "b", children: [block({ id: "child" })] }))).toBe(false);
  });
});

describe("headingItemsFromBlocks", () => {
  it("collects nested headings in document order with their level", () => {
    const blocks = [
      block({
        id: "h1",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Intro", styles: {} }],
        children: [
          block({ id: "h2", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Nested", styles: {} }] }),
        ],
      }),
      block({
        id: "p",
        children: [block({ id: "h3", type: "heading", props: {}, content: [] })],
      }),
    ];

    expect(headingItemsFromBlocks(blocks)).toEqual([
      { id: "h1", level: 1, title: "Intro" },
      { id: "h2", level: 2, title: "Nested" },
      { id: "h3", level: 1, title: "" },
    ]);
  });
});

describe("blockElementSelector", () => {
  it("escapes ids so they cannot break out of the attribute selector", () => {
    const selector = blockElementSelector('evil"] , body [x="');
    document.body.innerHTML = `<div class="bn-block-outer" data-id="safe"></div>`;
    expect(() => document.querySelectorAll(selector)).not.toThrow();
    expect(document.querySelectorAll(selector)).toHaveLength(0);
    expect(document.querySelector(blockElementSelector("safe"))).not.toBeNull();
  });
});

describe("disableSpellcheck", () => {
  it("disables spellcheck on text targets but leaves checkboxes untouched", () => {
    document.body.innerHTML = `
      <div id="root">
        <div contenteditable="true" id="editable"></div>
        <input id="text" type="text" />
        <input id="plain" />
        <input id="checkbox" type="checkbox" />
        <textarea id="area"></textarea>
      </div>`;
    const root = document.getElementById("root")!;
    disableSpellcheck(root);

    for (const id of ["root", "editable", "text", "plain", "area"]) {
      const element = document.getElementById(id)!;
      expect(element.getAttribute("spellcheck"), id).toBe("false");
      expect(element.getAttribute("autocorrect"), id).toBe("off");
      expect(element.getAttribute("autocapitalize"), id).toBe("off");
    }
    // Touching checkbox attributes makes ProseMirror re-create the node view
    // and loop forever (see editorDom.ts).
    expect(document.getElementById("checkbox")!.hasAttribute("spellcheck")).toBe(false);
  });

  it("does not rewrite attributes that are already set", () => {
    document.body.innerHTML = `<div id="root" spellcheck="false" autocorrect="off" autocapitalize="off"></div>`;
    const root = document.getElementById("root")!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(root, { attributes: true });
    disableSpellcheck(root);
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    expect(mutations).toHaveLength(0);
  });

  it("ignores a null element", () => {
    expect(() => disableSpellcheck(null)).not.toThrow();
  });
});

describe("isNativeTextInput", () => {
  it("recognises inputs and textareas only", () => {
    expect(isNativeTextInput(document.createElement("input"))).toBe(true);
    expect(isNativeTextInput(document.createElement("textarea"))).toBe(true);
    expect(isNativeTextInput(document.createElement("div"))).toBe(false);
    expect(isNativeTextInput(null)).toBe(false);
  });
});
