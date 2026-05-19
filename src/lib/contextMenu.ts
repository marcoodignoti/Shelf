export function clampContextMenuPosition(
  pointerX: number,
  pointerY: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth: number,
  menuHeight: number
): { left: number; top: number } {
  const margin = 12;
  return {
    left: Math.max(margin, Math.min(pointerX, viewportWidth - menuWidth - margin)),
    top: Math.max(margin, Math.min(pointerY, viewportHeight - menuHeight - margin)),
  };
}
