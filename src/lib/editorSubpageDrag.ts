import { reorderedSiblingIds } from "./pageOrder";

export type EditorSubpageDropTarget = {
  pageId: string;
  position: "before" | "after";
};

export function subpageDropTargetFromRow(
  row: HTMLElement | null,
  sourceId: string,
  clientY: number,
): EditorSubpageDropTarget | null {
  const targetId = row?.dataset.subpageRowId;
  if (!row || !targetId || targetId === sourceId) return null;

  const rect = row.getBoundingClientRect();
  const position: EditorSubpageDropTarget["position"] =
    clientY - rect.top < rect.height / 2 ? "before" : "after";
  return { pageId: targetId, position };
}

export function orderedSubpageIdsFromDropTarget(
  siblingIds: string[],
  sourceId: string,
  target: EditorSubpageDropTarget,
): string[] | null {
  const orderedIds = reorderedSiblingIds(
    siblingIds,
    sourceId,
    target.pageId,
    target.position,
  );
  return orderedIds.join("\0") === siblingIds.join("\0") ? null : orderedIds;
}
