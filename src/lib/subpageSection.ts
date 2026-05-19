export type SubpageSectionMode = "list" | "hover-create";

export function subpageSectionMode(childCount: number): SubpageSectionMode {
  return childCount > 0 ? "list" : "hover-create";
}
