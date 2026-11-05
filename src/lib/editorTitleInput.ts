import type { TitleEnterBehavior } from "./preferences";

export function titleEnterShouldInsertNewline(
  behavior: TitleEnterBehavior,
  modifiers: { altKey: boolean; shiftKey: boolean },
): boolean {
  return behavior === "newline"
    ? !modifiers.altKey
    : modifiers.altKey || modifiers.shiftKey;
}

export type TitleBeforeInputAction = "ignore" | "focus-body" | "insert-newline";

/**
 * A line break that reaches `beforeinput` (e.g. from an IME, where keydown
 * cannot cancel it) only stays in the title when keydown saw a newline
 * modifier; otherwise focus moves to the editor body.
 */
export function titleBeforeInputAction(inputType: string, modifierWasHeld: boolean): TitleBeforeInputAction {
  if (inputType !== "insertLineBreak") return "ignore";
  return modifierWasHeld ? "insert-newline" : "focus-body";
}
