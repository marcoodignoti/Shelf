import { clampStudioPanelRatio } from "./studio";

export type StudioViewMode = "split" | "pdf" | "note";
export type StudioPdfDisplayMode = "continuous" | "single" | "two-page";

function panelRatioStorageKey(documentId: string): string {
  return `opennotion-studio-panel-ratio-${documentId}`;
}

function viewModeStorageKey(documentId: string): string {
  return `opennotion-studio-view-mode-${documentId}`;
}

function pdfDisplayModeStorageKey(documentId: string): string {
  return `shelf-studio-pdf-display-mode-${documentId}`;
}

export function getStoredPanelRatio(documentId: string): number {
  const storedRatio = Number(localStorage.getItem(panelRatioStorageKey(documentId)));
  return clampStudioPanelRatio(Number.isFinite(storedRatio) ? storedRatio : 50);
}

export function storePanelRatio(documentId: string, ratio: number): void {
  localStorage.setItem(panelRatioStorageKey(documentId), String(clampStudioPanelRatio(ratio)));
}

export function getStoredViewMode(documentId: string): StudioViewMode {
  const storedMode = localStorage.getItem(viewModeStorageKey(documentId));
  return storedMode === "pdf" || storedMode === "note" ? storedMode : "split";
}

export function storeViewMode(documentId: string, mode: StudioViewMode): void {
  localStorage.setItem(viewModeStorageKey(documentId), mode);
}

export function getStoredPdfDisplayMode(documentId: string): StudioPdfDisplayMode {
  const storedMode = localStorage.getItem(pdfDisplayModeStorageKey(documentId));
  return storedMode === "single" || storedMode === "two-page" ? storedMode : "continuous";
}

export function storePdfDisplayMode(documentId: string, mode: StudioPdfDisplayMode): void {
  localStorage.setItem(pdfDisplayModeStorageKey(documentId), mode);
}
