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
    expect(userMessageForError(new Error("Missing AI API key"))).toBe(
      "Add an OpenRouter API key in Settings before using AI."
    );
    expect(
      userMessageForError(
        new Error("AI provider returned 404 Not Found: No endpoints found for model deepseek/deepseek-v4-flash:free")
      )
    ).toBe("The selected AI model is not available right now. Choose another free model in Settings.");
    expect(userMessageForError(new Error("AI provider returned 401 Unauthorized: invalid API key"))).toBe(
      "OpenRouter rejected the API key. Check or replace it in Settings."
    );
    expect(userMessageForError(new Error("AI provider returned 429 Too Many Requests: rate limit"))).toBe(
      "OpenRouter rate-limited this request. Try again shortly or choose another free model."
    );
    expect(userMessageForError(new Error("AI response did not include content"))).toBe(
      "The AI model returned an invalid response. Try again or choose another free model in Settings."
    );
  });

  it("uses a generic fallback for unknown errors", () => {
    expect(userMessageForError({ nope: true })).toBe("Something went wrong. Please try again.");
  });

  it("does not treat every denied message as a permission error", () => {
    expect(userMessageForError("request denied by validation")).toBe("Something went wrong. Please try again.");
  });
});
