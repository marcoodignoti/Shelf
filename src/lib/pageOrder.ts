export type DropPosition = "before" | "inside" | "after";

export function reorderedSiblingIds(
  siblingIds: string[],
  draggedId: string,
  targetId: string,
  position: DropPosition
): string[] {
  if (
    position === "inside" ||
    draggedId === targetId ||
    !siblingIds.includes(draggedId) ||
    !siblingIds.includes(targetId)
  ) {
    return siblingIds;
  }

  const withoutDragged = siblingIds.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;

  return [
    ...withoutDragged.slice(0, insertIndex),
    draggedId,
    ...withoutDragged.slice(insertIndex),
  ];
}

export function reorderedWithMovedPageId(
  siblingIds: string[],
  movedId: string,
  targetId: string,
  position: DropPosition
): string[] {
  if (position === "inside" || movedId === targetId || !siblingIds.includes(targetId)) {
    return siblingIds;
  }

  const withoutMoved = siblingIds.filter((id) => id !== movedId);
  const targetIndex = withoutMoved.indexOf(targetId);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;

  return [
    ...withoutMoved.slice(0, insertIndex),
    movedId,
    ...withoutMoved.slice(insertIndex),
  ];
}

export function dropPositionFromOffset(offsetY: number, rowHeight: number): DropPosition {
  if (rowHeight <= 0) return "inside";

  const beforeThreshold = rowHeight * 0.3;
  const afterThreshold = rowHeight * 0.7;

  if (offsetY < beforeThreshold) return "before";
  if (offsetY > afterThreshold) return "after";
  return "inside";
}
