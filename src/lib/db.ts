import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export type PageKind = 'note' | 'studio_note';

export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  search_text: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
  is_template: number;
  is_database?: number;
  database_schema?: string | null;
  properties?: string | null;
  sort_order: number;
  page_kind: PageKind;
  created_at: string;
  updated_at: string;
}

export interface SearchResult extends Page {
  matched_content: string | null;
}

export async function getPages(): Promise<Page[]> {
  return await invoke<Page[]>('list_pages');
}

export async function getAllPages(): Promise<Page[]> {
  return await invoke<Page[]>('list_all_pages');
}

export async function searchPages(query: string): Promise<SearchResult[]> {
  return await invoke<SearchResult[]>('search_pages', { query });
}

export async function getPage(id: string): Promise<Page | null> {
  return await invoke<Page | null>('get_page', { id });
}

export async function createPage(title: string = 'Untitled', parentId: string | null = null): Promise<Page> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return await invoke<Page>('create_page', {
    id,
    title,
    parentId,
    createdAt: now
  });
}

export async function createStudioNotePage(id: string, title: string): Promise<Page> {
  const now = new Date().toISOString();
  const page = await invoke<Page>('create_page', {
    id,
    title,
    parentId: null,
    createdAt: now
  });

  await updatePage(id, { page_kind: 'studio_note' });
  return { ...page, page_kind: 'studio_note' };
}

export async function updatePage(id: string, updates: Partial<Page>): Promise<void> {
  const now = new Date().toISOString();
  const allowedColumns = new Set<keyof Page>([
    'title',
    'parent_id',
    'content',
    'search_text',
    'icon',
    'cover_url',
    'is_deleted',
    'is_favorite',
    'is_template',
    'is_database',
    'database_schema',
    'properties',
    'page_kind'
  ]);
  
  const safeUpdates: Partial<Page> = {};
  
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedColumns.has(key as keyof Page)) continue;
    safeUpdates[key as keyof Page] = value as never;
  }
  
  if (Object.keys(safeUpdates).length === 0) return;
  
  await invoke('update_page', { id, updates: safeUpdates, updatedAt: now });
}

export async function deletePage(id: string): Promise<void> {
  await invoke('delete_page', { id });
}

export async function movePage(id: string, parentId: string | null): Promise<void> {
  await invoke('move_page', {
    id,
    parentId,
    updatedAt: new Date().toISOString()
  });
}

export async function reorderPages(parentId: string | null, orderedIds: string[]): Promise<void> {
  await invoke('reorder_pages', {
    parentId,
    orderedIds,
    updatedAt: new Date().toISOString()
  });
}

export async function importPages(pages: Page[]): Promise<number> {
  return await invoke<number>('import_pages', { pages });
}

export async function toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
  await invoke('toggle_favorite', { id, isFavorite });
}

export async function toggleTemplate(id: string, isTemplate: boolean): Promise<void> {
  await invoke('toggle_template', { id, isTemplate });
}

export async function createPageFromTemplate(
  templateId: string,
  parentId: string | null = null
): Promise<Page> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return await invoke<Page>('create_page_from_template', {
    id,
    templateId,
    parentId,
    createdAt: now,
  });
}

export async function duplicatePage(sourceId: string): Promise<Page> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return await invoke<Page>('duplicate_page', {
    id,
    sourceId,
    createdAt: now,
  });
}

export async function importCoverImage(sourcePath: string, pageId: string): Promise<string> {
  return await invoke<string>('import_cover_image', { sourcePath, pageId });
}

export async function importEditorImage(file: File, pageId: string): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return await invoke<string>('import_editor_image', {
    pageId,
    fileName: file.name || 'image',
    bytes,
  });
}

export function coverImageSrc(coverUrl: string): string {
  if (/^(https?:|data:|blob:|asset:)/i.test(coverUrl)) {
    return coverUrl;
  }

  return convertFileSrc(coverUrl);
}
