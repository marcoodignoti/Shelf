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

export function saveStatusLabel(state: EditorSaveState): string {
  switch (state.status) {
    case "saved":
      return "Saved";
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving...";
    case "error":
      return "Save failed";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
