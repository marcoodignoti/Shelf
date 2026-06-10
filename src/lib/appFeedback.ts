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

  // If the error message is already one of our pre-translated user-facing messages, preserve it
  if (
    message === "Image must be 10 MB or smaller." ||
    message === "Video must be 512 MB or smaller." ||
    message === "Video must be MP4, M4V, MOV, or WebM." ||
    message === "Image must be PNG, JPG, WebP, or GIF." ||
    message === "Image content is not supported." ||
    message === "Video content is not supported." ||
    message === "Could not import that media file."
  ) {
    return message;
  }

  if (message === "Backup file is not valid JSON") return "That backup file is not valid JSON.";
  if (message === "Backup file has invalid pages") return "That backup file does not contain valid pages.";
  if (message === "Backup file version is not supported") return "That backup file version is not supported.";
  if (message === "page cannot be moved under itself") return "A page cannot be moved under itself.";
  if (message === "page cannot be moved under one of its descendants") {
    return "A page cannot be moved under one of its subpages.";
  }
  if (lower.includes("image must be 10 mb or smaller")) {
    return "Image must be 10 MB or smaller.";
  }
  if (lower.includes("video must be 512 mb or smaller")) {
    return "Video must be 512 MB or smaller.";
  }
  if (lower.includes("video must be mp4, m4v, mov, or webm")) {
    return "Video must be MP4, M4V, MOV, or WebM.";
  }
  if (lower.includes("image must be png, jpg, webp, or gif")) {
    return "Image must be PNG, JPG, WebP, or GIF.";
  }
  if (lower.includes("content is not a supported image")) {
    return "Image content is not supported.";
  }
  if (lower.includes("content is not a supported video")) {
    return "Video content is not supported.";
  }
  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "OpenNotion does not have permission to complete that action.";
  }

  return "Something went wrong. Please try again.";
}
