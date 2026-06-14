export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  multiple?: boolean;
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}

type OpenDialogResult = string | string[] | null;
export type DesktopUpdateEventName =
  | "desktop-update-checking"
  | "desktop-update-available"
  | "desktop-update-not-available"
  | "desktop-update-download-progress"
  | "desktop-update-downloaded"
  | "desktop-update-error";

export interface DesktopUpdateInfo {
  version?: string;
  releaseName?: string;
  releaseDate?: string;
}

export interface ExportFilePayload {
  relativePath: string;
  content: string;
}

export interface ExportFilesOptions extends SaveDialogOptions {
  files: ExportFilePayload[];
}

export interface ExportFilesResult {
  path: string;
  fileCount: number;
}

export interface ImportedMediaFile {
  sourceName: string;
  path: string;
}

export interface ImportedFile {
  path: string;
  content: string;
}

interface ShelfDesktopBridge {
	  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	  open(options?: OpenDialogOptions): Promise<OpenDialogResult>;
	  save(options?: SaveDialogOptions): Promise<string | null>;
	  exportBackup?(options?: { defaultPath?: string; exportedAt?: string }): Promise<number | null>;
	  importBackup?(options?: { importedAt?: string }): Promise<number | null>;
	  importStudioDocument?(options: { documentId: string; notePageId: string; importedAt?: string }): Promise<unknown | null>;
	  replaceStudioDocumentFile?(options: { id: string; updatedAt?: string }): Promise<unknown | null>;
	  importCoverImage?(options: { pageId: string }): Promise<string | null>;
	  importProfileAvatar?(): Promise<string | null>;
	  importEditorMediaFiles?(options: { kind: "image" | "video"; pageId: string }): Promise<ImportedMediaFile[]>;
	  exportFiles?(options: ExportFilesOptions): Promise<ExportFilesResult | null>;
	  importPageFile?(options?: OpenDialogOptions): Promise<ImportedFile | null>;
  fileSrc(filePath: string): string;
  studioPdfSrc?(documentId: string): string;
  onDesktopUpdate?(callback: (eventName: DesktopUpdateEventName, payload: unknown) => void): () => void;
  autoUpdateActive?(): boolean;
  installUpdateNow?(): Promise<null>;
}

declare global {
  interface Window {
    openNotion?: ShelfDesktopBridge;
  }
}

function bridge(): ShelfDesktopBridge {
  if (!window.openNotion) {
    throw new Error("Shelf desktop bridge is not available");
  }
  return window.openNotion;
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return await bridge().invoke<T>(command, args);
}

export async function openDialog(options?: OpenDialogOptions): Promise<OpenDialogResult> {
  return await bridge().open(options);
}

export async function saveDialog(options?: SaveDialogOptions): Promise<string | null> {
  return await bridge().save(options);
}

export async function exportBackupWithDialog(options?: { defaultPath?: string; exportedAt?: string }): Promise<number | null> {
  const desktop = bridge();
  if (!desktop.exportBackup) throw new Error("backup export is not available in this build");
  return await desktop.exportBackup(options);
}

export async function importBackupWithDialog(options?: { importedAt?: string }): Promise<number | null> {
  const desktop = bridge();
  if (!desktop.importBackup) throw new Error("backup import is not available in this build");
  return await desktop.importBackup(options);
}

export async function importStudioDocumentWithDialog<T>(options: { documentId: string; notePageId: string; importedAt?: string }): Promise<T | null> {
  const desktop = bridge();
  if (!desktop.importStudioDocument) throw new Error("Studio document import is not available in this build");
  return await desktop.importStudioDocument(options) as T | null;
}

export async function replaceStudioDocumentFileWithDialog<T>(options: { id: string; updatedAt?: string }): Promise<T | null> {
  const desktop = bridge();
  if (!desktop.replaceStudioDocumentFile) throw new Error("Studio document file replace is not available in this build");
  return await desktop.replaceStudioDocumentFile(options) as T | null;
}

export async function importCoverImageWithDialog(pageId: string): Promise<string | null> {
  const desktop = bridge();
  if (!desktop.importCoverImage) throw new Error("cover image import is not available in this build");
  return await desktop.importCoverImage({ pageId });
}

export async function importProfileAvatarWithDialog(): Promise<string | null> {
  const desktop = bridge();
  if (!desktop.importProfileAvatar) throw new Error("profile avatar import is not available in this build");
  return await desktop.importProfileAvatar();
}

export async function importEditorMediaFilesWithDialog(kind: "image" | "video", pageId: string): Promise<ImportedMediaFile[]> {
  const desktop = bridge();
  if (!desktop.importEditorMediaFiles) throw new Error("editor media import is not available in this build");
  return await desktop.importEditorMediaFiles({ kind, pageId });
}

export function fileSrc(filePath: string): string {
  return bridge().fileSrc(filePath);
}

export function studioDocumentPdfSrc(documentId: string, filePath: string): string {
  const desktop = bridge();
  return desktop.studioPdfSrc ? desktop.studioPdfSrc(documentId) : desktop.fileSrc(filePath);
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url });
}

// Both helpers run the native dialog and the file IO in the main process so
// the renderer never hands a filesystem path over IPC. They resolve to null
// when the user cancels the dialog.
export async function exportFilesWithDialog(options: ExportFilesOptions): Promise<ExportFilesResult | null> {
  const desktop = bridge();
  if (!desktop.exportFiles) throw new Error("exporting files is not available in this build");
  return await desktop.exportFiles(options);
}

export async function importPageFileWithDialog(options?: OpenDialogOptions): Promise<ImportedFile | null> {
  const desktop = bridge();
  if (!desktop.importPageFile) throw new Error("importing files is not available in this build");
  return await desktop.importPageFile(options);
}

// Reserved for legacy desktop updater events. Current builds use the signed
// manifest update flow on every platform, so the real Electron bridge returns
// false and the manifest notice remains active.
export function desktopAutoUpdateActive(): boolean {
  try {
    return window.openNotion?.autoUpdateActive?.() ?? false;
  } catch {
    return false;
  }
}

export async function installDesktopUpdateNow(): Promise<void> {
  const desktop = bridge();
  if (!desktop.installUpdateNow) {
    throw new Error("restart-to-update is not available in this build");
  }
  await desktop.installUpdateNow();
}
