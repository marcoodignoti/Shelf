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
  if (message === "page cannot be moved under itself") return "A page cannot be moved under itself.";
  if (message === "page cannot be moved under one of its descendants") {
    return "A page cannot be moved under one of its subpages.";
  }
  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "OpenNotion does not have permission to complete that action.";
  }

  return "Something went wrong. Please try again.";
}
