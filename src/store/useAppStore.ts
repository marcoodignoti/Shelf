import { create } from 'zustand';
import { AppNotice, userMessageForError } from '../lib/appFeedback';
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
  type EditorFont,
  type EditorFontSize,
  type LocalePreference,
  type PageWidth,
  type TitleEnterBehavior,
} from '../lib/preferences';
import { openDialog, invoke, exportFilesWithDialog, importPageFileWithDialog } from '../lib/desktop';
import { prepareImportedPages } from '../lib/backup';
import { buildMarkdownTreeFiles, buildPageTreeExport, sanitizeExportFilename } from '../lib/exportPages';
import { createPageMarkdownRenderer } from '../lib/exportMarkdown';
import { Page, getPage, getPages, createPage, createPageFromTemplate, createStudioNotePage, deletePage, duplicatePage, movePage, reorderPages, toggleFavorite, toggleTemplate, updatePage } from '../lib/db';
import { WorkspaceProfile, getWorkspaceProfile, updateWorkspaceProfile, importProfileAvatar } from '../lib/profile';
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from '../lib/navigation';
import { openNotionEditorSchema } from '../lib/editorMath';
import {
  createStudioProject,
  deleteStudioDocument,
  deleteStudioProject,
  importStudioDocument,
  listAllStudioDocumentPageLinks,
  listStudioDocuments,
  listStudioProjects,
  renameStudioDocument,
  renameStudioProject,
  replaceStudioDocumentFile,
  StudioDocument,
  StudioDocumentPageLink,
  StudioPanelLayout,
  StudioProject,
  updateStudioDocumentProject,
  updateStudioDocumentViewerState,
  updateStudioProjectParent
} from '../lib/studio';

type Theme = 'light' | 'dark' | 'system';
type WorkspaceMode = 'notes' | 'studio';
type CreatePageOptions = { select?: boolean };

interface AppState {
  pages: Page[];
  currentPageId: string | null;
  isLoading: boolean;
  error: string | null;
  notice: AppNotice | null;
  isCommandPaletteOpen: boolean;
  workspaceMode: WorkspaceMode;
  studioDocuments: StudioDocument[];
  studioDocumentPageLinks: StudioDocumentPageLink[];
  studioProjects: StudioProject[];
  currentStudioDocumentId: string | null;
  profile: WorkspaceProfile | null;
  fetchProfile: () => Promise<void>;
  updateProfileAction: (patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null }) => Promise<void>;
  importProfileAvatarAction: (sourcePath: string) => Promise<void>;
  fetchPages: () => Promise<void>;
  fetchStudioDocuments: () => Promise<void>;
  setCurrentPageId: (id: string | null) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setCurrentStudioDocumentId: (id: string | null) => void;
  importStudioPdfAction: (projectId?: string | null) => Promise<StudioDocument | null>;
  replaceStudioPdfAction: (documentId: string) => Promise<StudioDocument | null>;
  updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
  createStudioProjectAction: (name: string, parentId?: string | null) => Promise<StudioProject | null>;
  renameStudioProjectAction: (id: string, name: string) => Promise<void>;
  updateStudioProjectParentAction: (id: string, parentId: string | null) => Promise<void>;
  deleteStudioProjectAction: (id: string) => Promise<void>;
  updateStudioDocumentProjectAction: (documentId: string, projectId: string | null) => Promise<void>;
  createMissingStudioNoteAction: (documentId: string) => Promise<Page | null>;
  renameStudioDocumentAction: (id: string, title: string) => Promise<void>;
  deleteStudioDocumentAction: (id: string) => Promise<void>;
  importPageAction: () => Promise<Page | null>;
  exportProjectNotesMarkdown: (project: StudioProject) => Promise<void>;
  exportProjectNotesJSON: (project: StudioProject) => Promise<void>;
  addPage: (title?: string, parentId?: string | null, options?: CreatePageOptions) => Promise<Page | null>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
  renamePageAction: (id: string, title: string) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  movePageAction: (id: string, parentId: string | null) => Promise<void>;
  reorderPagesAction: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
  addPageFromTemplate: (templateId: string, parentId?: string | null, options?: CreatePageOptions) => Promise<Page | null>;
  duplicatePageAction: (sourceId: string, options?: CreatePageOptions) => Promise<Page | null>;
  clearError: () => void;
  setError: (error: string | null) => void;
  clearNotice: () => void;
  showSuccess: (message: string) => void;
  showError: (error: unknown) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  theme: Theme;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTheme: (theme: Theme) => void;
  localePreference: LocalePreference;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  pageWidth: PageWidth;
  titleEnterBehavior: TitleEnterBehavior;
  setLocalePreference: (value: LocalePreference) => void;
  setEditorFont: (value: EditorFont) => void;
  setEditorFontSize: (value: EditorFontSize) => void;
  setPageWidth: (value: PageWidth) => void;
  setTitleEnterBehavior: (value: TitleEnterBehavior) => void;
}

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 240;

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredTheme(): Theme {
  const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-theme') : null;
  return isTheme(storedTheme) ? storedTheme : 'system';
}

const getStoredPreference = <T>(key: string, parse: (value: unknown) => T): T =>
  parse(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);

function getStoredPageId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-current-page-id') : null;
}

function getStoredWorkspaceMode(): WorkspaceMode {
  return (typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-workspace-mode') : null) === 'studio' ? 'studio' : 'notes';
}

function getStoredStudioDocumentId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-current-studio-document-id') : null;
}

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function getStoredSidebarWidth(): number {
  const storedWidth = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-sidebar-width') : null);
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
}

function logStoreError(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(error);
  }
}

function descendantPageIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    }
  }
  return ids;
}

export const useAppStore = create<AppState>((set, get) => ({
  pages: [],
  profile: null,
  currentPageId: getStoredPageId(),
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,
  workspaceMode: getStoredWorkspaceMode(),
  studioDocuments: [],
  studioDocumentPageLinks: [],
  studioProjects: [],
  currentStudioDocumentId: getStoredStudioDocumentId(),
  isSidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  theme: getStoredTheme(),
  localePreference: getStoredPreference(PREFERENCE_STORAGE_KEYS.locale, parseLocalePreference),
  editorFont: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFont, parseEditorFont),
  editorFontSize: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFontSize, parseEditorFontSize),
  pageWidth: getStoredPreference(PREFERENCE_STORAGE_KEYS.pageWidth, parsePageWidth),
  titleEnterBehavior: getStoredPreference(PREFERENCE_STORAGE_KEYS.titleEnter, parseTitleEnterBehavior),
  fetchProfile: async () => {
    try {
      set({ profile: await getWorkspaceProfile() });
    } catch (error) {
      get().showError(error);
    }
  },
  updateProfileAction: async (patch) => {
    const previousProfile = get().profile;
    if (previousProfile) {
      set({ profile: { ...previousProfile, ...patch } as WorkspaceProfile });
    }
    try {
      set({ profile: await updateWorkspaceProfile(patch) });
    } catch (error) {
      set({ profile: previousProfile });
      get().showError(error);
    }
  },
  importProfileAvatarAction: async (sourcePath) => {
    try {
      const avatarPath = await importProfileAvatar(sourcePath);
      const current = get().profile;
      if (current) set({ profile: { ...current, avatarPath } });
    } catch (error) {
      get().showError(error);
    }
  },
  fetchPages: async () => {
    try {
      const pages = await getPages();
      set((state) => {
        const currentPageId = resolveCurrentPageId(pages, state.currentPageId);
        localStorage.setItem('opennotion-current-page-id', currentPageId);
        return { pages, currentPageId, isLoading: false, error: null };
      });
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message }, isLoading: false });
    }
  },
  fetchStudioDocuments: async () => {
    try {
      const [studioDocuments, studioProjects, studioDocumentPageLinks] = await Promise.all([
        listStudioDocuments(),
        listStudioProjects(),
        listAllStudioDocumentPageLinks(),
      ]);
      const studioNotes = (await Promise.all(
        studioDocuments.map(async (document) => {
          return await getPage(document.note_page_id);
        })
      )).filter((page): page is Page => Boolean(page));
      set((state) => {
        const currentStudioDocumentId = studioDocuments.some((document) => document.id === state.currentStudioDocumentId)
          ? state.currentStudioDocumentId
          : studioDocuments[0]?.id ?? null;
        const studioNoteIds = new Set(studioNotes.map((page) => page.id));
        const pages = [
          ...state.pages.filter((page) => !studioNoteIds.has(page.id)),
          ...studioNotes,
        ];

        if (currentStudioDocumentId) {
          localStorage.setItem('opennotion-current-studio-document-id', currentStudioDocumentId);
        } else {
          localStorage.removeItem('opennotion-current-studio-document-id');
        }

        return { studioDocuments, studioDocumentPageLinks, studioProjects, currentStudioDocumentId, pages, error: null };
      });
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
    }
  },
  setCurrentPageId: (id) => {
    localStorage.setItem('opennotion-current-page-id', id || HOME_PAGE_ID);
    set({ currentPageId: id });
  },
  setWorkspaceMode: (mode) => {
    localStorage.setItem('opennotion-workspace-mode', mode);
    set({ workspaceMode: mode });
  },
  setCurrentStudioDocumentId: (id) => {
    if (id) {
      localStorage.setItem('opennotion-current-studio-document-id', id);
    } else {
      localStorage.removeItem('opennotion-current-studio-document-id');
    }
    set({ currentStudioDocumentId: id });
  },
  clearError: () => set({ error: null }),
  setError: (error) => set({ error, notice: error ? { kind: 'error', message: error } : null }),
  clearNotice: () => set({ notice: null }),
  showSuccess: (message) => set({ notice: { kind: 'success', message }, error: null }),
  showError: (error) => {
    const message = userMessageForError(error);
    set({ error: message, notice: { kind: 'error', message } });
  },
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  importStudioPdfAction: async (projectId = null) => {
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path || Array.isArray(path)) return null;

      const document = await importStudioDocument(path);
      const importedDocument = projectId
        ? { ...document, project_id: projectId, updated_at: new Date().toISOString() }
        : document;
      if (projectId) {
        await updateStudioDocumentProject(document.id, projectId);
      }
      const note = await getPage(document.note_page_id);
      const studioDocumentPageLinks = await listAllStudioDocumentPageLinks();
      localStorage.setItem('opennotion-workspace-mode', 'studio');
      localStorage.setItem('opennotion-current-studio-document-id', document.id);
      set((state) => ({
        studioDocuments: [importedDocument, ...state.studioDocuments.filter((candidate) => candidate.id !== document.id)],
        studioDocumentPageLinks,
        pages: note ? [...state.pages.filter((page) => page.id !== note.id), note] : state.pages,
        currentStudioDocumentId: document.id,
        workspaceMode: 'studio',
        error: null
      }));
      return importedDocument;
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  replaceStudioPdfAction: async (documentId) => {
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path || Array.isArray(path)) return null;

      const document = await replaceStudioDocumentFile(documentId, path);
      set((state) => ({
        studioDocuments: state.studioDocuments.map((candidate) =>
          candidate.id === document.id ? document : candidate
        ),
        currentStudioDocumentId: document.id,
        error: null,
        notice: { kind: 'success', message: 'Studio PDF reimported.' }
      }));
      localStorage.setItem('opennotion-current-studio-document-id', document.id);
      return document;
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  updateStudioViewerAction: async (id, updates) => {
    const last_opened_at = new Date().toISOString();
    set((state) => ({
      studioDocuments: state.studioDocuments.map((document) =>
        document.id === id ? { ...document, ...updates, last_opened_at } : document
      )
    }));
    try {
      await updateStudioDocumentViewerState(id, { ...updates, last_opened_at });
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      await get().fetchStudioDocuments();
    }
  },
  createStudioProjectAction: async (name, parentId = null): Promise<StudioProject | null> => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;

    try {
      const project = await createStudioProject(trimmedName, parentId);
      set((state) => ({
        studioProjects: [...state.studioProjects.filter((candidate) => candidate.id !== project.id), project]
          .sort((first, second) => first.sort_order - second.sort_order || first.name.localeCompare(second.name)),
        error: null,
        notice: { kind: 'success', message: 'Studio project created.' }
      }));
      return project;
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  renameStudioProjectAction: async (id, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const previousProjects = get().studioProjects;
    const updated_at = new Date().toISOString();
    set((state) => ({
      studioProjects: state.studioProjects.map((project) =>
        project.id === id ? { ...project, name: trimmedName, updated_at } : project
      ),
      error: null
    }));

    try {
      await renameStudioProject(id, trimmedName);
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ studioProjects: previousProjects, error: message, notice: { kind: 'error', message } });
    }
  },
  updateStudioProjectParentAction: async (id, parentId) => {
    if (id === parentId) return;

    const previousProjects = get().studioProjects;
    const updated_at = new Date().toISOString();
    set((state) => ({
      studioProjects: state.studioProjects.map((project) =>
        project.id === id ? { ...project, parent_id: parentId, updated_at } : project
      ),
      error: null
    }));

    try {
      await updateStudioProjectParent(id, parentId);
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ studioProjects: previousProjects, error: message, notice: { kind: 'error', message } });
    }
  },
  deleteStudioProjectAction: async (id) => {
    const previousProjects = get().studioProjects;
    const previousDocuments = get().studioDocuments;

    set((state) => ({
      studioProjects: state.studioProjects.filter((project) => project.id !== id),
      studioDocuments: state.studioDocuments.map((document) =>
        document.project_id === id ? { ...document, project_id: null } : document
      ),
      error: null
    }));

    try {
      await deleteStudioProject(id);
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ studioProjects: previousProjects, studioDocuments: previousDocuments, error: message, notice: { kind: 'error', message } });
    }
  },
  updateStudioDocumentProjectAction: async (documentId, projectId) => {
    const previousDocuments = get().studioDocuments;
    const updated_at = new Date().toISOString();

    set((state) => ({
      studioDocuments: state.studioDocuments.map((document) =>
        document.id === documentId ? { ...document, project_id: projectId, updated_at } : document
      ),
      error: null
    }));

    try {
      await updateStudioDocumentProject(documentId, projectId);
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ studioDocuments: previousDocuments, error: message, notice: { kind: 'error', message } });
    }
  },
  createMissingStudioNoteAction: async (documentId): Promise<Page | null> => {
    const document = get().studioDocuments.find((candidate) => candidate.id === documentId);
    if (!document) return null;

    try {
      const existingNote = await getPage(document.note_page_id);
      const note = existingNote ?? await createStudioNotePage(document.note_page_id, `${document.title} Notes`);
      set((state) => ({
        pages: [note, ...state.pages.filter((page) => page.id !== note.id)],
        error: null,
        notice: { kind: 'success', message: 'Linked note created.' }
      }));
      return note;
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      await get().fetchStudioDocuments();
      return null;
    }
  },
  renameStudioDocumentAction: async (id, title) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;

    const previousDocuments = get().studioDocuments;
    const previousPages = get().pages;
    const document = previousDocuments.find((candidate) => candidate.id === id);
    const updated_at = new Date().toISOString();

    set((state) => ({
      studioDocuments: state.studioDocuments.map((candidate) =>
        candidate.id === id ? { ...candidate, title: nextTitle, updated_at } : candidate
      ),
      pages: document
        ? state.pages.map((page) =>
            page.id === document.note_page_id ? { ...page, title: `${nextTitle} Notes`, updated_at } : page
          )
        : state.pages,
      error: null
    }));

    try {
      await renameStudioDocument(id, nextTitle);
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ studioDocuments: previousDocuments, pages: previousPages, error: message, notice: { kind: 'error', message } });
    }
  },
  deleteStudioDocumentAction: async (id) => {
    const document = get().studioDocuments.find((candidate) => candidate.id === id);
    if (!document) return;

    try {
      await deleteStudioDocument(id);
      set((state) => {
        const studioDocuments = state.studioDocuments.filter((candidate) => candidate.id !== id);
        const currentStudioDocumentId = state.currentStudioDocumentId === id
          ? studioDocuments[0]?.id ?? null
          : state.currentStudioDocumentId;

        if (currentStudioDocumentId) {
          localStorage.setItem('opennotion-current-studio-document-id', currentStudioDocumentId);
        } else {
          localStorage.removeItem('opennotion-current-studio-document-id');
        }

        return {
          studioDocuments,
          studioDocumentPageLinks: state.studioDocumentPageLinks.filter((link) => link.document_id !== id),
          currentStudioDocumentId,
          pages: state.pages.filter((page) => page.id !== document.note_page_id),
          error: null,
          notice: { kind: 'success', message: 'Studio document deleted.' }
        };
      });
    } catch (error: unknown) {
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      await get().fetchStudioDocuments();
    }
  },
  importPageAction: async () => {
    try {
      const imported = await importPageFileWithDialog({
        multiple: false,
        filters: [{ name: "Page Export (.json, .md)", extensions: ["json", "md"] }],
      });
      if (!imported) return null;
      const { path: filePath, content: raw } = imported;
      if (filePath.endsWith(".json")) {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("Invalid JSON file");
        }

        if (parsed.type === "page_tree") {
          const pages = prepareImportedPages(parsed.pages);
          const rootPage = pages.find((p) => p.id === parsed.root_page_id || !p.parent_id);
          if (rootPage) {
            rootPage.parent_id = null;
          }
          await invoke("import_pages", { pages });
          await get().fetchPages();
          get().showSuccess("Page tree imported successfully.");
          return rootPage || null;
        } else if (parsed.version === 1 && Array.isArray(parsed.pages)) {
          await invoke("import_backup", { path: filePath });
          await get().fetchPages();
          get().showSuccess("Workspace backup imported successfully.");
          return null;
        } else {
          throw new Error("Unsupported JSON export format");
        }
      } else if (filePath.endsWith(".md")) {
        const fileName = filePath.split(/[/\\]/).pop() || "Untitled";
        const title = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
        
        const { BlockNoteEditor } = await import("@blocknote/core");
        const tempEditor = BlockNoteEditor.create({
          schema: openNotionEditorSchema,
        });
        const blocks = tempEditor.tryParseMarkdownToBlocks(raw);
        
        const newPage = await get().addPage(title, null, { select: false });
        if (newPage) {
          await updatePage(newPage.id, { content: JSON.stringify(blocks) });
          await get().fetchPages();
          get().showSuccess(`Page "${title}" imported from Markdown.`);
          const updatedPage = get().pages.find((p) => p.id === newPage.id);
          return updatedPage || newPage;
        }
      }
      return null;
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
      return null;
    }
  },
  exportProjectNotesMarkdown: async (project) => {
    try {
      const docs = get().studioDocuments.filter((d) => d.project_id === project.id);
      if (docs.length === 0) {
        get().showSuccess("Project has no documents to export.");
        return;
      }

      const pages = get().pages;
      const rootPages = docs
        .map((doc) => pages.find((p) => p.id === doc.note_page_id))
        .filter((page): page is Page => Boolean(page));
      if (rootPages.length === 0) {
        get().showSuccess("Project has no notes to export.");
        return;
      }

      const renderPageMarkdown = await createPageMarkdownRenderer();
      const files = await buildMarkdownTreeFiles(pages, rootPages, renderPageMarkdown);
      const result = await exportFilesWithDialog({
        defaultPath: `${sanitizeExportFilename(project.name)} Notes.md`,
        filters: [{ name: "Markdown Folder Structure", extensions: ["md"] }],
        files,
      });
      if (!result) return;

      get().showSuccess(`Project notes exported to: ${result.path}`);
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  exportProjectNotesJSON: async (project) => {
    try {
      const docs = get().studioDocuments.filter((d) => d.project_id === project.id);
      if (docs.length === 0) {
        get().showSuccess("Project has no documents to export.");
        return;
      }

      const pages = get().pages;
      const notePageIds = docs.map((d) => d.note_page_id);
      const exportData = buildPageTreeExport(pages, notePageIds, new Date().toISOString());
      const fileName = `${sanitizeExportFilename(project.name)} Notes.json`;
      const result = await exportFilesWithDialog({
        defaultPath: fileName,
        filters: [{ name: "OpenNotion Page Tree", extensions: ["json"] }],
        files: [{ relativePath: fileName, content: JSON.stringify(exportData, null, 2) }],
      });
      if (!result) return;

      get().showSuccess(`Project notes exported as JSON to: ${result.path}`);
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  addPage: async (title = 'Untitled', parentId = null, options = {}) => {
    try {
      const newPage = await createPage(title, parentId);
      if (options.select !== false) {
        localStorage.setItem('opennotion-current-page-id', newPage.id);
      }
      set((state) => ({
        pages: [newPage, ...state.pages],
        currentPageId: options.select === false ? state.currentPageId : newPage.id,
        error: null
      }));
      return newPage;
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  updatePageOptimistically: (id, updates) => set((state) => ({
    pages: state.pages.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  renamePageAction: async (id, title) => {
    const previousPages = get().pages;
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, title } : p),
        error: null
      }));
      await updatePage(id, { title });
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ pages: previousPages, error: message, notice: { kind: 'error', message } });
    }
  },
  removePage: async (id) => {
    const previousPages = get().pages;
    const previousStudioDocumentPageLinks = get().studioDocumentPageLinks;
    const deletedIds = descendantPageIds(previousPages, id);
    const optimisticPages = previousPages.filter((page) => !deletedIds.has(page.id));
    set((state) => ({
      pages: optimisticPages,
      studioDocumentPageLinks: state.studioDocumentPageLinks.filter((link) => !deletedIds.has(link.page_id)),
      currentPageId: resolveCurrentPageIdAfterDeletion(optimisticPages, state.currentPageId, id, deletedIds, previousPages)
    }));

    try {
      await deletePage(id);
      const [pages, studioDocumentPageLinks] = await Promise.all([
        getPages(),
        listAllStudioDocumentPageLinks(),
      ]);
      set((state) => ({
        pages,
        studioDocumentPageLinks,
        currentPageId: resolveCurrentPageIdAfterDeletion(pages, state.currentPageId, id, deletedIds, previousPages)
      }));
      const current = get().currentPageId;
      localStorage.setItem('opennotion-current-page-id', current || HOME_PAGE_ID);
      await get().fetchStudioDocuments();
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({
        pages: previousPages,
        studioDocumentPageLinks: previousStudioDocumentPageLinks,
        error: message,
        notice: { kind: 'error', message }
      });
    }
  },
  movePageAction: async (id, parentId) => {
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, parent_id: parentId, sort_order: 0 } : p),
        error: null
      }));
      await movePage(id, parentId);
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      await get().fetchPages();
    }
  },
  reorderPagesAction: async (parentId, orderedIds) => {
    const previousPages = get().pages;
    try {
      set((state) => ({
        pages: state.pages.map((page) => {
          if (page.parent_id !== parentId) return page;
          const nextIndex = orderedIds.indexOf(page.id);
          return nextIndex === -1 ? page : { ...page, sort_order: nextIndex };
        }),
        error: null
      }));
      await reorderPages(parentId, orderedIds);
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ pages: previousPages, error: message, notice: { kind: 'error', message } });
    }
  },
  toggleFavoriteAction: async (id, isFavorite) => {
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, is_favorite: isFavorite ? 1 : 0 } : p)
      }));
      await toggleFavorite(id, isFavorite);
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
    }
  },
  toggleTemplateAction: async (id, isTemplate) => {
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, is_template: isTemplate ? 1 : 0 } : p)
      }));
      await toggleTemplate(id, isTemplate);
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
    }
  },
  addPageFromTemplate: async (templateId, parentId = null, options = {}) => {
    try {
      const newPage = await createPageFromTemplate(templateId, parentId);
      if (options.select !== false) {
        localStorage.setItem('opennotion-current-page-id', newPage.id);
      }
      set((state) => ({
        pages: [newPage, ...state.pages],
        currentPageId: options.select === false ? state.currentPageId : newPage.id,
        error: null
      }));
      return newPage;
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  duplicatePageAction: async (sourceId, options = {}) => {
    try {
      const newPage = await duplicatePage(sourceId);
      if (options.select !== false) {
        localStorage.setItem('opennotion-current-page-id', newPage.id);
      }
      set((state) => ({
        pages: [newPage, ...state.pages],
        currentPageId: options.select === false ? state.currentPageId : newPage.id,
        error: null
      }));
      return newPage;
    } catch (error: unknown) {
      logStoreError(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarWidth: (width) => {
    const sidebarWidth = clampSidebarWidth(width);
    localStorage.setItem('opennotion-sidebar-width', String(sidebarWidth));
    set({ sidebarWidth });
  },

  setTheme: (theme) => {
    localStorage.setItem('opennotion-theme', theme);
    set({ theme });
  },

  setLocalePreference: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, value);
    set({ localePreference: value });
  },
  setEditorFont: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFont, value);
    set({ editorFont: value });
  },
  setEditorFontSize: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFontSize, value);
    set({ editorFontSize: value });
  },
  setPageWidth: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.pageWidth, value);
    set({ pageWidth: value });
  },
  setTitleEnterBehavior: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.titleEnter, value);
    set({ titleEnterBehavior: value });
  },
}));
