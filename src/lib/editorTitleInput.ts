import type { TitleEnterBehavior } from "./preferences";

export function titleEnterShouldInsertNewline(
  behavior: TitleEnterBehavior,
  modifiers: { altKey: boolean; shiftKey: boolean },
): boolean {
  return behavior === "newline"
    ? !modifiers.altKey
    : modifiers.altKey || modifiers.shiftKey;
}
