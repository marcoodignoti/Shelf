import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type StudioPanelLayout = "pdf-left" | "note-left";

export interface StudioDocument {
  id: string;
  title: string;
  original_filename: string;
  stored_file_path: string;
  note_page_id: string;
  last_opened_at: string;
  viewer_zoom: number;
  viewer_page: number;
  panel_layout: StudioPanelLayout;
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

export async function importStudioDocument(sourcePath: string): Promise<StudioDocument> {
  return await invoke<StudioDocument>("import_studio_document", {
    documentId: crypto.randomUUID(),
    notePageId: crypto.randomUUID(),
    sourcePath,
    importedAt: new Date().toISOString(),
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

export function clampStudioZoom(zoom: number): number {
  return Math.max(25, Math.min(300, Math.round(zoom)));
}

export function clampStudioPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.round(page));
}

export function buildStudioPdfHash({ page, zoom }: { page: number; zoom: number }): string {
  return `#page=${clampStudioPage(page)}&zoom=${clampStudioZoom(zoom)}`;
}

export function studioPdfSrc(document: StudioDocument): string {
  return `${convertFileSrc(document.stored_file_path)}${buildStudioPdfHash({
    page: document.viewer_page,
    zoom: document.viewer_zoom,
  })}`;
}
