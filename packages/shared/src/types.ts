export type PageKind = 'note' | 'studio_note' | 'project';

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
  content_loaded?: number;
}

export interface SearchResult extends Page {
  matched_content: string | null;
}
