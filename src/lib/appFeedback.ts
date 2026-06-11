import type { TranslationKey, TranslationParams } from "./i18n";

export type AppNotice =
  | { kind: "success" | "error"; messageKey: TranslationKey; params?: TranslationParams }
  | { kind: "success" | "error"; rawMessage: string };

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

export function noticeKeyForError(error: unknown): { messageKey: TranslationKey; params?: TranslationParams } | { rawMessage: string } {
  const message = rawErrorMessage(error);
  const lower = message.toLowerCase();

  if (message === "Backup file is not valid JSON") return { messageKey: "notice.backupNotJSON" };
  if (message === "Backup file has invalid pages") return { messageKey: "notice.backupInvalidPages" };
  if (message === "Backup file version is not supported") return { messageKey: "notice.backupVersionUnsupported" };
  if (message === "page cannot be moved under itself") return { messageKey: "notice.pageCannotMoveUnderItself" };
  if (message === "page cannot be moved under one of its descendants") {
    return { messageKey: "notice.pageCannotMoveUnderDescendant" };
  }
  if (lower.includes("image must be 10 mb or smaller")) return { messageKey: "notice.imageTooLarge" };
  if (lower.includes("video must be 512 mb or smaller")) return { messageKey: "notice.videoTooLarge" };
  if (lower.includes("video must be mp4, m4v, mov, or webm")) return { messageKey: "notice.videoWrongFormat" };
  if (lower.includes("image must be png, jpg, webp, or gif")) return { messageKey: "notice.imageWrongFormat" };
  if (lower.includes("content is not a supported image")) return { messageKey: "notice.imageContentUnsupported" };
  if (lower.includes("content is not a supported video")) return { messageKey: "notice.videoContentUnsupported" };
  if (lower.includes("permission denied") || lower.includes("access denied")) return { messageKey: "notice.noPermission" };

  // Media-specific messages that come pre-translated from editorMediaUserMessage
  if (lower.includes("image must be 10 mb or smaller")) return { messageKey: "notice.imageTooLarge" };
  if (lower.includes("video must be 512 mb or smaller")) return { messageKey: "notice.videoTooLarge" };
  if (lower.includes("could not import that media file")) return { messageKey: "notice.mediaCouldNotImport" };

  if (message) return { rawMessage: message };
  return { messageKey: "notice.somethingWentWrong" };
}
