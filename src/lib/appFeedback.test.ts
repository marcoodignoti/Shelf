import { describe, expect, it } from "vitest";
import { userMessageForError } from "./appFeedback";

describe("userMessageForError", () => {
  it("maps known technical errors to readable messages", () => {
    expect(userMessageForError(new Error("Backup file is not valid JSON"))).toBe(
      "That backup file is not valid JSON."
    );
    expect(userMessageForError("page cannot be moved under itself")).toBe(
      "A page cannot be moved under itself."
    );
    expect(userMessageForError("EACCES: permission denied")).toBe(
      "OpenNotion does not have permission to complete that action."
    );
  });

  it("uses a generic fallback for unknown errors", () => {
    expect(userMessageForError({ nope: true })).toBe("Something went wrong. Please try again.");
  });

  it("does not treat every denied message as a permission error", () => {
    expect(userMessageForError("request denied by validation")).toBe("Something went wrong. Please try again.");
  });
});
