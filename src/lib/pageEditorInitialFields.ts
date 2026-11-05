import type { Page } from "./db";

export type InitialEditorFields = {
  title: string;
  icon: string;
  coverUrl: string;
  /** Pending (unsaved) content, or null to fall back to the saved page. */
  content: string | null;
};

/**
 * Seeds the editor's header fields: edits queued in localStorage by a
 * previous session (see pendingPageSaves) win over the saved page row, and a
 * pending `null` icon/cover means the user removed it.
 */
export function initialEditorFields(
  page: Pick<Page, "title" | "icon" | "cover_url" | "content">,
  pending: Partial<Page> | null,
): InitialEditorFields {
  const hasPendingField = (field: keyof Page) =>
    pending !== null && Object.prototype.hasOwnProperty.call(pending, field);

  const title = hasPendingField("title") && typeof pending?.title === "string" ? pending.title : page.title;
  const icon = hasPendingField("icon")
    ? (typeof pending?.icon === "string" ? pending.icon : null)
    : page.icon;
  const coverUrl = hasPendingField("cover_url")
    ? (typeof pending?.cover_url === "string" ? pending.cover_url : null)
    : page.cover_url;

  return {
    title: title || "",
    icon: icon || "",
    coverUrl: coverUrl || "",
    content: typeof pending?.content === "string" ? pending.content : null,
  };
}
