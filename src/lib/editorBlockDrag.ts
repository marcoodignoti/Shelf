import { Block, BlockNoteEditor } from "@blocknote/core";
import { blockDropPlacementFromOffset, BlockDropPlacement } from "./blockDrag";

export type BlockDropTarget = {
  blockId: string;
  placement: BlockDropPlacement;
  element: HTMLElement;
};

export function moveEditorBlock(editor: BlockNoteEditor, sourceId: string, targetId: string, placement: BlockDropPlacement) {
  if (sourceId === targetId) return;

  const sourceBlock = editor.getBlock(sourceId);
  const targetBlock = editor.getBlock(targetId);

  if (!sourceBlock || !targetBlock || blockContainsId(sourceBlock, targetId)) {
    return;
  }

  editor.transact(() => {
    editor.removeBlocks([sourceBlock]);
    editor.insertBlocks([sourceBlock], targetBlock, placement);
  });
}

export function blockContainsId(block: Block, blockId: string): boolean {
  return block.children.some((child) => child.id === blockId || blockContainsId(child, blockId));
}

export function clearBlockDropIndicator() {
  document
    .querySelectorAll<HTMLElement>("[data-opennotion-block-drop]")
    .forEach((element) => element.removeAttribute("data-opennotion-block-drop"));
}

export function blockElementFromPoint(editor: BlockNoteEditor, clientX: number, clientY: number): HTMLElement | null {
  const editorElement = editor.domElement;

  if (!editorElement) return null;

  const editorRect = editorElement.getBoundingClientRect();
  const x = Math.min(Math.max(clientX, editorRect.left + 8), editorRect.right - 8);
  const element = document
    .elementsFromPoint(x, clientY)
    .find((candidate) => editorElement.contains(candidate) && candidate.closest(".bn-block-outer[data-id]"));

  return (element?.closest(".bn-block-outer[data-id]") as HTMLElement | null) ?? null;
}

export function blockDropTargetFromPoint(editor: BlockNoteEditor, clientX: number, clientY: number, sourceId: string): BlockDropTarget | null {
  const element = blockElementFromPoint(editor, clientX, clientY);
  const blockId = element?.dataset.id;

  if (!element || !blockId || blockId === sourceId) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const placement = blockDropPlacementFromOffset(clientY - rect.top, rect.height);

  return { blockId, placement, element };
}
