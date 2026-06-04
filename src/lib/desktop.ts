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

interface OpenNotionDesktopBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  open(options?: OpenDialogOptions): Promise<OpenDialogResult>;
  save(options?: SaveDialogOptions): Promise<string | null>;
  fileSrc(filePath: string): string;
  studioPdfSrc?(documentId: string): string;
}

declare global {
  interface Window {
    openNotion?: OpenNotionDesktopBridge;
  }
}

function bridge(): OpenNotionDesktopBridge {
  if (!window.openNotion) {
    throw new Error("OpenNotion desktop bridge is not available");
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
