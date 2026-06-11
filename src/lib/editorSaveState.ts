import type { TranslationKey } from "./i18n";

export type EditorSaveState =
  | { status: "saved" }
  | { status: "dirty" }
  | { status: "saving" }
  | { status: "error"; message: string };

export type EditorSaveAction =
  | { type: "edit" }
  | { type: "saving" }
  | { type: "saved" }
  | { type: "failed"; message: string };

export function editorSaveReducer(
  state: EditorSaveState,
  action: EditorSaveAction
): EditorSaveState {
  switch (action.type) {
    case "edit":
      return { status: "dirty" };
    case "saving":
      return { status: "saving" };
    case "saved":
      return { status: "saved" };
    case "failed":
      if (state.status === "dirty") {
        return state;
      }
      return { status: "error", message: action.message };
  }
}

export function saveStatusLabel(
  state: EditorSaveState,
  t?: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
  const tr = t ?? ((k: TranslationKey) => k);
  switch (state.status) {
    case "saved":
      return tr("editor.saveStatusSaved");
    case "dirty":
      return tr("editor.saveStatusUnsaved");
    case "saving":
      return tr("editor.saveStatusSaving");
    case "error":
      return tr("editor.saveStatusFailed");
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
