import { describe, expect, it } from "vitest";
import { editorSaveReducer, saveStatusLabel } from "./editorSaveState";

describe("editorSaveReducer", () => {
  it("tracks dirty, saving, saved, and error transitions", () => {
    expect(editorSaveReducer({ status: "saved" }, { type: "edit" })).toEqual({ status: "dirty" });
    expect(editorSaveReducer({ status: "dirty" }, { type: "saving" })).toEqual({ status: "saving" });
    expect(editorSaveReducer({ status: "saving" }, { type: "saved" })).toEqual({ status: "saved" });
    expect(editorSaveReducer({ status: "saving" }, { type: "failed", message: "disk full" })).toEqual({
      status: "error",
      message: "disk full",
    });
  });

  it("keeps new edits dirty when an older save fails", () => {
    const dirtyState = editorSaveReducer({ status: "saving" }, { type: "edit" });

    expect(editorSaveReducer(dirtyState, { type: "failed", message: "late failure" })).toEqual({
      status: "dirty",
    });
  });
});

describe("saveStatusLabel", () => {
  it("returns compact labels for editor chrome", () => {
    expect(saveStatusLabel({ status: "saved" })).toBe("Saved");
    expect(saveStatusLabel({ status: "dirty" })).toBe("Unsaved");
    expect(saveStatusLabel({ status: "saving" })).toBe("Saving...");
    expect(saveStatusLabel({ status: "error", message: "network" })).toBe("Save failed");
  });
});
