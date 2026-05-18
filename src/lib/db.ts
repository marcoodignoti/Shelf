import { invoke } from '@tauri-apps/api/core';

export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
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

export async function updatePage(id: string, updates: Partial<Page>): Promise<void> {
  const now = new Date().toISOString();
  const allowedColumns = new Set<keyof Page>([
    'title',
    'parent_id',
    'content',
    'icon',
    'cover_url',
    'is_deleted',
    'is_favorite'
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

export async function getDeletedPages(): Promise<Page[]> {
  return await invoke<Page[]>('list_deleted_pages');
}

export async function restorePage(id: string): Promise<void> {
  await invoke('restore_page', { id });
}

export async function hardDeletePage(id: string): Promise<void> {
  await invoke('hard_delete_page', { id });
}

export async function toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
  await invoke('toggle_favorite', { id, isFavorite });
}
