export type LocalePreference = "system" | "en" | "it";
export type EditorFont = "sans" | "serif" | "mono";
export type EditorFontSize = "small" | "default" | "large";
export type PageWidth = "centered" | "full";
export type TitleEnterBehavior = "body" | "newline";

export const PREFERENCE_STORAGE_KEYS = {
  locale: "opennotion-locale",
  editorFont: "opennotion-editor-font",
  editorFontSize: "opennotion-editor-font-size",
  pageWidth: "opennotion-page-width",
  titleEnter: "opennotion-title-enter",
} as const;

function parseChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function parseLocalePreference(value: unknown): LocalePreference {
  return parseChoice(value, ["system", "en", "it"], "system");
}

export function parseEditorFont(value: unknown): EditorFont {
  return parseChoice(value, ["sans", "serif", "mono"], "sans");
}

export function parseEditorFontSize(value: unknown): EditorFontSize {
  return parseChoice(value, ["small", "default", "large"], "default");
}

export function parsePageWidth(value: unknown): PageWidth {
  return parseChoice(value, ["centered", "full"], "centered");
}

export function parseTitleEnterBehavior(value: unknown): TitleEnterBehavior {
  return parseChoice(value, ["body", "newline"], "body");
}
