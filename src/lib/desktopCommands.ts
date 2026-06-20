import type { Page, SearchResult } from "./db";
import type { WorkspaceProfile } from "./profile";
import type {
  StudioDocument,
  StudioDocumentPageLink,
  StudioPageUnificationPreview,
  StudioProject,
} from "./studio";

export const DESKTOP_COMMAND_NAMES = [
  "list_pages",
  "list_all_pages",
  "export_backup",
  "import_backup",
  "import_backup_content",
  "search_pages",
  "get_page",
  "create_page",
  "create_project",
  "update_page",
  "delete_page",
  "delete_project",
  "move_page",
  "reorder_pages",
  "import_pages",
  "list_studio_documents",
  "list_studio_projects",
  "preview_studio_page_unification",
  "migrate_studio_page_unification",
  "create_studio_project",
  "rename_studio_project",
  "update_studio_project_parent",
  "delete_studio_project",
  "update_studio_document_project",
  "list_all_studio_document_page_links",
  "list_studio_document_page_links",
  "link_studio_document_page",
  "update_studio_document_page_link",
  "unlink_studio_document_page",
  "import_studio_document",
  "replace_studio_document_file",
  "update_studio_document_viewer_state",
  "rename_studio_document",
  "open_studio_document_file",
  "reveal_studio_document_file",
  "delete_studio_document",
  "toggle_favorite",
  "toggle_template",
  "create_page_from_template",
  "duplicate_page",
  "import_cover_image",
  "import_editor_image",
  "import_editor_video",
  "open_external_url",
  "fetch_update_manifest",
  "download_update_artifact",
  "cancel_update_download",
  "get_workspace_profile",
  "update_workspace_profile",
  "import_profile_avatar",
  "show_character_palette",
] as const;

const DESKTOP_COMMAND_NAME_SET = new Set<string>(DESKTOP_COMMAND_NAMES);

export type DesktopCommandName = (typeof DESKTOP_COMMAND_NAMES)[number];

export interface DesktopCommandMap {
  list_pages: { args: undefined; result: Page[] };
  list_all_pages: { args: undefined; result: Page[] };
  export_backup: { args: { path: string; exportedAt?: string; exported_at?: string }; result: number };
  import_backup: { args: { path: string; importedAt?: string; imported_at?: string }; result: number };
  import_backup_content: { args: { content: string; importedAt?: string; imported_at?: string }; result: number };
  search_pages: { args: { query: string }; result: SearchResult[] };
  get_page: { args: { id: string }; result: Page | null };
  create_page: { args: { id: string; title?: string; parentId?: string | null; parent_id?: string | null; createdAt?: string; created_at?: string }; result: Page };
  create_project: { args: { id: string; title?: string; createdAt?: string; created_at?: string }; result: Page };
  update_page: { args: { id: string; updates: Partial<Page>; updatedAt?: string; updated_at?: string }; result: void };
  delete_page: { args: { id: string }; result: void };
  delete_project: { args: { id: string; updatedAt?: string; updated_at?: string }; result: void };
  move_page: { args: { id: string; parentId?: string | null; parent_id?: string | null; updatedAt?: string; updated_at?: string }; result: void };
  reorder_pages: { args: { parentId?: string | null; parent_id?: string | null; orderedIds?: string[]; ordered_ids?: string[]; updatedAt?: string; updated_at?: string }; result: void };
  import_pages: { args: { pages: Page[] }; result: number };
  list_studio_documents: { args: undefined; result: StudioDocument[] };
  list_studio_projects: { args: undefined; result: StudioProject[] };
  preview_studio_page_unification: { args: undefined; result: StudioPageUnificationPreview };
  migrate_studio_page_unification: { args: { migratedAt?: string; migrated_at?: string }; result: StudioPageUnificationPreview };
  create_studio_project: { args: { id: string; name: string; parentId?: string | null; parent_id?: string | null; createdAt?: string; created_at?: string }; result: StudioProject };
  rename_studio_project: { args: { id: string; name: string; updatedAt?: string; updated_at?: string }; result: void };
  update_studio_project_parent: { args: { id: string; parentId?: string | null; parent_id?: string | null; updatedAt?: string; updated_at?: string }; result: void };
  delete_studio_project: { args: { id: string; updatedAt?: string; updated_at?: string }; result: void };
  update_studio_document_project: { args: { id: string; projectId?: string | null; project_id?: string | null; updatedAt?: string; updated_at?: string }; result: void };
  list_all_studio_document_page_links: { args: undefined; result: StudioDocumentPageLink[] };
  list_studio_document_page_links: { args: { documentId?: string; document_id?: string }; result: StudioDocumentPageLink[] };
  link_studio_document_page: { args: { id: string; documentId?: string; document_id?: string; pageId?: string; page_id?: string; pdfPage?: number | null; pdf_page?: number | null; label?: string | null; createdAt?: string; created_at?: string }; result: StudioDocumentPageLink };
  update_studio_document_page_link: { args: { id: string; pdfPage?: number | null; pdf_page?: number | null; label?: string | null; updatedAt?: string; updated_at?: string }; result: void };
  unlink_studio_document_page: { args: { id: string }; result: void };
  import_studio_document: { args: { documentId?: string; document_id?: string; notePageId?: string; note_page_id?: string; sourcePath?: string; source_path?: string; importedAt?: string; imported_at?: string }; result: StudioDocument };
  replace_studio_document_file: { args: { id: string; sourcePath?: string; source_path?: string; updatedAt?: string; updated_at?: string }; result: StudioDocument };
  update_studio_document_viewer_state: { args: { id: string; updates: Partial<Pick<StudioDocument, "viewer_zoom" | "viewer_page" | "panel_layout" | "last_opened_at">>; updatedAt?: string; updated_at?: string }; result: void };
  rename_studio_document: { args: { id: string; title: string; updatedAt?: string; updated_at?: string }; result: void };
  open_studio_document_file: { args: { id: string }; result: void };
  reveal_studio_document_file: { args: { id: string }; result: void };
  delete_studio_document: { args: { id: string }; result: void };
  toggle_favorite: { args: { id: string; isFavorite?: boolean; is_favorite?: boolean }; result: void };
  toggle_template: { args: { id: string; isTemplate?: boolean; is_template?: boolean }; result: void };
  create_page_from_template: { args: { id: string; templateId?: string; template_id?: string; parentId?: string | null; parent_id?: string | null; createdAt?: string; created_at?: string }; result: Page };
  duplicate_page: { args: { id: string; sourceId?: string; source_id?: string; createdAt?: string; created_at?: string }; result: Page };
  import_cover_image: { args: { pageId?: string; page_id?: string; sourcePath?: string; source_path?: string }; result: string };
  import_editor_image: { args: { pageId?: string; page_id?: string; fileName?: string; file_name?: string; bytes?: number[] | Uint8Array; sourcePath?: string; source_path?: string }; result: string };
  import_editor_video: { args: { pageId?: string; page_id?: string; fileName?: string; file_name?: string; bytes?: number[] | Uint8Array; sourcePath?: string; source_path?: string }; result: string };
  open_external_url: { args: { url: string }; result: void };
  fetch_update_manifest: { args: { url: string }; result: unknown };
  download_update_artifact: { args: { url: string; sha256: string; downloadToken?: string; download_token?: string; downloadId?: string; download_id?: string }; result: { path: string; bytes: number; sha256: string } | { cancelled: true; bytes: number; sha256: string } };
  cancel_update_download: { args: { downloadId?: string; download_id?: string }; result: { cancelled: boolean } };
  get_workspace_profile: { args: undefined; result: WorkspaceProfile };
  update_workspace_profile: { args: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: string | null }; result: WorkspaceProfile };
  import_profile_avatar: { args: { sourcePath?: string; source_path?: string }; result: string };
  show_character_palette: { args: undefined; result: null };
}

export type DesktopCommandArgs<C extends DesktopCommandName> =
  DesktopCommandMap[C]["args"];

export type DesktopCommandResult<C extends DesktopCommandName> =
  DesktopCommandMap[C]["result"];

export function isDesktopCommandName(value: string): value is DesktopCommandName {
  return DESKTOP_COMMAND_NAME_SET.has(value);
}
