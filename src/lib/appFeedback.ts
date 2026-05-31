export type AppNotice = {
  kind: "success" | "error";
  message: string;
};

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

export function userMessageForError(error: unknown): string {
  const message = rawErrorMessage(error);
  const lower = message.toLowerCase();

  if (message === "Backup file is not valid JSON") return "That backup file is not valid JSON.";
  if (message === "Backup file has invalid pages") return "That backup file does not contain valid pages.";
  if (message === "Backup file version is not supported") return "That backup file version is not supported.";
  if (
    message === "Missing AI API key" ||
    message === "Add an OpenRouter API key in Settings before using AI."
  ) {
    return "Add an OpenRouter API key in Settings before using AI.";
  }
  if (lower.includes("ai provider returned")) {
    if (
      lower.includes("no endpoints found") ||
      lower.includes("model") && lower.includes("not found") ||
      lower.includes("unsupported model")
    ) {
      return "The selected AI model is not available right now. Choose another free model in Settings.";
    }
    if (lower.includes("401") || lower.includes("403") || lower.includes("api key")) {
      return "OpenRouter rejected the API key. Check or replace it in Settings.";
    }
    if (lower.includes("rate limit") || lower.includes("429")) {
      return "OpenRouter rate-limited this request. Try again shortly or choose another free model.";
    }
    return "OpenRouter could not complete the request. Try again or choose another free model in Settings.";
  }
  if (lower.includes("ai response was invalid") || lower.includes("ai response did not include content")) {
    return "The AI model returned an invalid response. Try again or choose another free model in Settings.";
  }
  if (message === "page cannot be moved under itself") return "A page cannot be moved under itself.";
  if (message === "page cannot be moved under one of its descendants") {
    return "A page cannot be moved under one of its subpages.";
  }
  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "OpenNotion does not have permission to complete that action.";
  }

  return "Something went wrong. Please try again.";
}
