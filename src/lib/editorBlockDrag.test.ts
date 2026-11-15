import { describe, expect, it, vi } from "vitest";
import type { Block, BlockNoteEditor } from "@blocknote/core";
import { blockContainsId, moveEditorBlock } from "./editorBlockDrag";

function block(id: string, children: Block[] = []): Block {
  return { id, type: "paragraph", props: {}, content: [], children } as unknown as Block;
}

function fakeEditor(blocks: Block[]) {
  const byId = new Map<string, Block>();
  const index = (list: Block[]) => list.forEach((b) => { byId.set(b.id, b); index(b.children); });
  index(blocks);
  const editor = {
    getBlock: vi.fn((id: string) => byId.get(id)),
    transact: vi.fn((work: () => void) => work()),
    removeBlocks: vi.fn(),
    insertBlocks: vi.fn(),
  };
  return editor as typeof editor & BlockNoteEditor;
}

describe("blockContainsId", () => {
  it("finds deeply nested descendants but not the block itself", () => {
    const tree = block("root", [block("a", [block("deep")]), block("b")]);
    expect(blockContainsId(tree, "deep")).toBe(true);
    expect(blockContainsId(tree, "b")).toBe(true);
    expect(blockContainsId(tree, "root")).toBe(false);
    expect(blockContainsId(tree, "missing")).toBe(false);
  });
});

describe("moveEditorBlock", () => {
  it("removes and re-inserts the source relative to the target in one transaction", () => {
    const source = block("source");
    const target = block("target");
    const editor = fakeEditor([source, target]);

    moveEditorBlock(editor, "source", "target", "after");

    expect(editor.transact).toHaveBeenCalledTimes(1);
    expect(editor.removeBlocks).toHaveBeenCalledWith([source]);
    expect(editor.insertBlocks).toHaveBeenCalledWith([source], target, "after");
  });

  it("refuses to drop a block onto itself, a missing block, or its own descendant", () => {
    const child = block("child");
    const parent = block("parent", [child]);
    const editor = fakeEditor([parent]);

    moveEditorBlock(editor, "parent", "parent", "before");
    moveEditorBlock(editor, "parent", "missing", "before");
    moveEditorBlock(editor, "missing", "parent", "before");
    moveEditorBlock(editor, "parent", "child", "after");

    expect(editor.transact).not.toHaveBeenCalled();
    expect(editor.removeBlocks).not.toHaveBeenCalled();
  });
});
