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

export interface ImportedFile {
  path: string;
  content: string;
}

interface ShelfDesktopBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  open(options?: OpenDialogOptions): Promise<OpenDialogResult>;
  save(options?: SaveDialogOptions): Promise<string | null>;
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

// True when the platform auto-updater (electron-updater on Windows installer
// builds) owns update delivery; the manifest-based notice defers to it.
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
