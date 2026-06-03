import { fileSrc, invoke } from "./desktop";

export type StudioPanelLayout = "pdf-left" | "note-left";

export const MAX_STUDIO_PDF_PAGES = 1000;

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

export interface StudioViewerUpdates {
  viewer_zoom?: number;
  viewer_page?: number;
  panel_layout?: StudioPanelLayout;
  last_opened_at?: string;
}

export async function listStudioDocuments(): Promise<StudioDocument[]> {
  return await invoke<StudioDocument[]>("list_studio_documents");
}

export async function listStudioProjects(): Promise<StudioProject[]> {
  return await invoke<StudioProject[]>("list_studio_projects");
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
  return `${fileSrc(document.stored_file_path)}${buildStudioPdfHash({
    page: document.viewer_page,
    zoom: document.viewer_zoom,
  })}`;
}
