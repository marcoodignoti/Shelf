export type BlockDropPlacement = "before" | "after";

export function blockDropPlacementFromOffset(offsetY: number, height: number): BlockDropPlacement {
  return offsetY < height / 2 ? "before" : "after";
}
