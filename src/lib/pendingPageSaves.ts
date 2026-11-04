import type { Page } from "./db";

const PENDING_PAGE_SAVE_VERSION = 1;
const STORAGE_PREFIX = "shelf-pending-page-save-v1:";

type PendingPageSaveRecord = {
  version: number;
  pageId: string;
  updates: Partial<Page>;
  queuedAt: string;
};

function hasOwnEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

export function pendingPageSaveStorageKey(pageId: string): string {
  return `${STORAGE_PREFIX}${pageId}`;
}

/**
 * Reads the last local autosave queue for a page. Malformed or stale records
 * are ignored and removed so a bad localStorage value cannot break the editor.
 */
export function readPendingPageUpdates(pageId: string): Partial<Page> | null {
  if (typeof window === "undefined") return null;

  const key = pendingPageSaveStorageKey(pageId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const record = JSON.parse(raw) as Partial<PendingPageSaveRecord>;
    if (
      record.version !== PENDING_PAGE_SAVE_VERSION ||
      record.pageId !== pageId ||
      !record.updates ||
      typeof record.updates !== "object" ||
      Array.isArray(record.updates)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }

    return hasOwnEntries(record.updates) ? record.updates : null;
  } catch {
    // SecurityError, quota/corrupt JSON, and unavailable storage must not
    // prevent the editor from opening. The in-memory queue remains authoritative.
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures; callers still have their in-memory updates.
    }
    return null;
  }
}

export function writePendingPageUpdates(pageId: string, updates: Partial<Page>): void {
  if (typeof window === "undefined") return;

  const key = pendingPageSaveStorageKey(pageId);
  if (!hasOwnEntries(updates)) {
    window.localStorage.removeItem(key);
    return;
  }

  const record: PendingPageSaveRecord = {
    version: PENDING_PAGE_SAVE_VERSION,
    pageId,
    updates,
    queuedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(key, JSON.stringify(record));
}

export function clearPendingPageUpdates(pageId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingPageSaveStorageKey(pageId));
}
