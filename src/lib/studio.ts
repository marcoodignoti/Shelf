import { invoke, studioDocumentPdfSrc } from "./desktop";
import type { Page } from "./db";

export type StudioPanelLayout = "pdf-left" | "note-left";

export const MAX_STUDIO_PDF_PAGES = 1000;
export const STUDIO_PDF_CONTINUOUS_OVERSCAN_PAGES = 4;
export const STUDIO_PDF_ESTIMATED_PAGE_GAP_PX = 18;
export const STUDIO_PDF_FALLBACK_PAGE_HEIGHT_PX = 792;

export interface StudioDocument {
  id: string;
  title: string;
  original_filename: string;
  stored_file_path: string;
  note_page_id: string;
  project_id: string | null;
  last_opened_at: string;
  viewer_zoom: number;
  viewer_page: number;
  panel_layout: StudioPanelLayout;
  created_at: string;
  updated_at: string;
}

export interface StudioProject {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StudioDocumentPageLink {
  id: string;
  document_id: string;
  page_id: string;
  pdf_page: number | null;
  label: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  page: Page;
}

export interface StudioViewerUpdates {
  viewer_zoom?: number;
  viewer_page?: number;
  panel_layout?: StudioPanelLayout;
  last_opened_at?: string;
}

export interface StudioContinuousPageWindow {
  pages: number[];
  beforeHeight: number;
  afterHeight: number;
}

export async function listStudioDocuments(): Promise<StudioDocument[]> {
  return await invoke<StudioDocument[]>("list_studio_documents");
}

export async function listStudioProjects(): Promise<StudioProject[]> {
  return await invoke<StudioProject[]>("list_studio_projects");
}

export async function listAllStudioDocumentPageLinks(): Promise<StudioDocumentPageLink[]> {
  return await invoke<StudioDocumentPageLink[]>("list_all_studio_document_page_links");
}

export async function createStudioProject(name: string, parentId: string | null = null): Promise<StudioProject> {
  const now = new Date().toISOString();
  return await invoke<StudioProject>("create_studio_project", {
    id: crypto.randomUUID(),
    name,
    parentId,
    createdAt: now,
  });
}

export async function renameStudioProject(id: string, name: string): Promise<void> {
  await invoke("rename_studio_project", {
    id,
    name,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateStudioProjectParent(id: string, parentId: string | null): Promise<void> {
  await invoke("update_studio_project_parent", {
    id,
    parentId,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteStudioProject(id: string): Promise<void> {
  await invoke("delete_studio_project", {
    id,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateStudioDocumentProject(id: string, projectId: string | null): Promise<void> {
  await invoke("update_studio_document_project", {
    id,
    projectId,
    updatedAt: new Date().toISOString(),
  });
}

export async function listStudioDocumentPageLinks(documentId: string): Promise<StudioDocumentPageLink[]> {
  return await invoke<StudioDocumentPageLink[]>("list_studio_document_page_links", { documentId });
}

export async function linkStudioDocumentPage(
  documentId: string,
  pageId: string,
  options: { pdfPage?: number | null; label?: string | null } = {}
): Promise<StudioDocumentPageLink> {
  return await invoke<StudioDocumentPageLink>("link_studio_document_page", {
    id: crypto.randomUUID(),
    documentId,
    pageId,
    pdfPage: options.pdfPage ?? null,
    label: options.label ?? null,
    createdAt: new Date().toISOString(),
  });
}

export async function updateStudioDocumentPageLink(
  id: string,
  updates: { pdfPage?: number | null; label?: string | null }
): Promise<void> {
  await invoke("update_studio_document_page_link", {
    id,
    pdfPage: updates.pdfPage ?? null,
    label: updates.label ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export async function unlinkStudioDocumentPage(id: string): Promise<void> {
  await invoke("unlink_studio_document_page", { id });
}

export async function importStudioDocument(sourcePath: string): Promise<StudioDocument> {
  return await invoke<StudioDocument>("import_studio_document", {
    documentId: crypto.randomUUID(),
    notePageId: crypto.randomUUID(),
    sourcePath,
    importedAt: new Date().toISOString(),
  });
}

export async function replaceStudioDocumentFile(id: string, sourcePath: string): Promise<StudioDocument> {
  return await invoke<StudioDocument>("replace_studio_document_file", {
    id,
    sourcePath,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateStudioDocumentViewerState(
  id: string,
  updates: StudioViewerUpdates
): Promise<void> {
  await invoke("update_studio_document_viewer_state", {
    id,
    updates,
    updatedAt: new Date().toISOString(),
  });
}

export async function renameStudioDocument(id: string, title: string): Promise<void> {
  await invoke("rename_studio_document", {
    id,
    title,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteStudioDocument(id: string): Promise<void> {
  await invoke("delete_studio_document", { id });
}

export async function openStudioDocumentFile(id: string): Promise<void> {
  await invoke("open_studio_document_file", { id });
}

export async function revealStudioDocumentFile(id: string): Promise<void> {
  await invoke("reveal_studio_document_file", { id });
}

export function clampStudioZoom(zoom: number): number {
  return Math.max(25, Math.min(300, Math.round(zoom)));
}

export function clampStudioPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.round(page));
}

export function isStudioPdfPageCountAllowed(pageCount: number): boolean {
  return Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= MAX_STUDIO_PDF_PAGES;
}

export function estimatedStudioPdfPageSlotHeight(zoom: number): number {
  return Math.max(1, Math.round(STUDIO_PDF_FALLBACK_PAGE_HEIGHT_PX * (clampStudioZoom(zoom) / 100))) + STUDIO_PDF_ESTIMATED_PAGE_GAP_PX;
}

export function buildStudioContinuousPageWindow({
  pageCount,
  page,
  scrollTop,
  viewportHeight,
  zoom,
}: {
  pageCount: number;
  page: number;
  scrollTop: number;
  viewportHeight: number;
  zoom: number;
}): StudioContinuousPageWindow {
  const safePageCount = Math.max(1, Math.min(MAX_STUDIO_PDF_PAGES, Math.floor(pageCount)));
  const currentPage = Math.min(clampStudioPage(page), safePageCount);
  const pageSlotHeight = estimatedStudioPdfPageSlotHeight(zoom);
  const visiblePageSlots = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / pageSlotHeight));
  const scrollPage = Number.isFinite(scrollTop) && scrollTop > 0
    ? Math.floor(scrollTop / pageSlotHeight) + 1
    : currentPage;
  const centerPage = Math.max(1, Math.min(safePageCount, scrollPage));
  const startPage = Math.max(1, centerPage - STUDIO_PDF_CONTINUOUS_OVERSCAN_PAGES);
  const endPage = Math.min(safePageCount, centerPage + visiblePageSlots + STUDIO_PDF_CONTINUOUS_OVERSCAN_PAGES);

  return {
    pages: Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index),
    beforeHeight: startPage > 1 ? (startPage - 1) * pageSlotHeight : 0,
    afterHeight: endPage < safePageCount ? (safePageCount - endPage) * pageSlotHeight : 0,
  };
}

export function buildStudioPdfHash({ page, zoom }: { page: number; zoom: number }): string {
  return `#page=${clampStudioPage(page)}&zoom=${clampStudioZoom(zoom)}`;
}

export function clampStudioPanelRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 50;
  return Math.max(30, Math.min(70, Math.round(ratio)));
}

export function buildStudioPanelGridColumns(layout: StudioPanelLayout, pdfRatio: number): string {
  const clampedRatio = clampStudioPanelRatio(pdfRatio);
  const leftRatio = layout === "pdf-left" ? clampedRatio : 100 - clampedRatio;
  const rightRatio = 100 - leftRatio;
  return `${leftRatio}% 6px ${rightRatio}%`;
}

export function studioPanelRatioFromPointer(
  layout: StudioPanelLayout,
  clientX: number,
  container: { left: number; width: number }
): number {
  if (container.width <= 0) return 50;
  const pointerRatio = ((clientX - container.left) / container.width) * 100;
  const pdfRatio = layout === "pdf-left" ? pointerRatio : 100 - pointerRatio;
  return clampStudioPanelRatio(pdfRatio);
}

export function studioPdfSrc(document: StudioDocument): string {
  return `${studioDocumentPdfSrc(document.id, document.stored_file_path)}${buildStudioPdfHash({
    page: document.viewer_page,
    zoom: document.viewer_zoom,
  })}`;
}
