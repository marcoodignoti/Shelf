export type EditorMediaKind = "image" | "video";

export type EditorMediaBlock = {
  type: EditorMediaKind;
  props: {
    name: string;
    url: string;
  };
};

const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const videoExtensions = new Set(["mp4", "m4v", "mov", "webm"]);

const mediaUserMessages = new Map<string, string>([
  ["image must be 10 MB or smaller", "Image must be 10 MB or smaller."],
  ["video must be 512 MB or smaller", "Video must be 512 MB or smaller."],
  ["video must be MP4, M4V, MOV, or WebM", "Video must be MP4, M4V, MOV, or WebM."],
  ["image must be PNG, JPG, WebP, or GIF", "Image must be PNG, JPG, WebP, or GIF."],
  ["content is not a supported image", "Image content is not supported."],
  ["content is not a supported video", "Video content is not supported."],
]);

export function fileNameFromPath(filePath: string, fallback: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || fallback;
}

export function editorMediaKindForFile(file: File): EditorMediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";

  return null;
}

export function editorMediaBlockProps(kind: EditorMediaKind, name: string, url: string): EditorMediaBlock {
  const fallbackName = kind === "video" ? "Video" : "Image";

  return {
    type: kind,
    props: {
      name: name || fallbackName,
      url,
    },
  };
}

export function editorMediaUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return mediaUserMessages.get(message) ?? "Could not import that media file.";
}
