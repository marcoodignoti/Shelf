import type { Page } from "./types";

export interface ListPagesRequest {
  since?: string;
}

export interface ListPagesResponse {
  pages: Page[];
}

export interface GetPageRequest {
  id: string;
}

export interface GetPageResponse {
  page: Page;
}

export interface CreatePageRequest {
  id: string;
  title?: string;
  content?: string;
  parentId?: string | null;
  createdAt: string;
}

export interface CreatePageResponse {
  id: string;
}

export interface UpdatePageRequest {
  id: string;
  updates: Partial<Pick<Page, "title" | "content" | "parent_id" | "icon" | "is_favorite" | "sort_order">>;
  updatedAt: string;
}

export type UpdatePageResponse = null;

export interface DeletePageRequest {
  id: string;
}

export type DeletePageResponse = null;

export interface PairRequest {
  token: string;
  name: string;
  platform: "ios" | "android";
}

export interface PairResponse {
  deviceToken: string;
  deviceId: string;
}

export interface SyncQueueEntry {
  page_id: string;
  pending_op: "update" | "create" | "delete";
  queued_at: string;
}

export interface SyncState {
  last_synced_at: string | null;
  desktop_device_id: string | null;
  last_pulled_cursor: string | null;
}
