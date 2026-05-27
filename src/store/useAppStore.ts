import { create } from 'zustand';
import { open } from '@tauri-apps/plugin-dialog';
import { AppNotice, userMessageForError } from '../lib/appFeedback';
import { Page, getPage, getPages, createPage, createPageFromTemplate, deletePage, duplicatePage, movePage, reorderPages, toggleFavorite, toggleTemplate, updatePage } from '../lib/db';
import { HOME_PAGE_ID, resolveCurrentPageId } from '../lib/navigation';
import { importStudioDocument, listStudioDocuments, StudioDocument, StudioPanelLayout, updateStudioDocumentViewerState } from '../lib/studio';

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
  currentStudioDocumentId: string | null;
  fetchPages: () => Promise<void>;
  fetchStudioDocuments: () => Promise<void>;
  setCurrentPageId: (id: string | null) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setCurrentStudioDocumentId: (id: string | null) => void;
  importStudioPdfAction: () => Promise<StudioDocument | null>;
  updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
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
  theme: Theme;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredTheme(): Theme {
  const storedTheme = localStorage.getItem('opennotion-theme');
  return isTheme(storedTheme) ? storedTheme : 'system';
}

function getStoredPageId(): string | null {
  return localStorage.getItem('opennotion-current-page-id');
}

function getStoredWorkspaceMode(): WorkspaceMode {
  return localStorage.getItem('opennotion-workspace-mode') === 'studio' ? 'studio' : 'notes';
}

function getStoredStudioDocumentId(): string | null {
  return localStorage.getItem('opennotion-current-studio-document-id');
}

export const useAppStore = create<AppState>((set) => ({
  pages: [],
  currentPageId: getStoredPageId(),
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,
  workspaceMode: getStoredWorkspaceMode(),
  studioDocuments: [],
  currentStudioDocumentId: getStoredStudioDocumentId(),
  isSidebarOpen: true,
  theme: getStoredTheme(),
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
      const studioDocuments = await listStudioDocuments();
      const studioNotes = (await Promise.all(
        studioDocuments.map((document) => getPage(document.note_page_id))
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

        return { studioDocuments, currentStudioDocumentId, pages, error: null };
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
  importStudioPdfAction: async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path || Array.isArray(path)) return null;

      const document = await importStudioDocument(path);
      const note = await getPage(document.note_page_id);
      localStorage.setItem('opennotion-workspace-mode', 'studio');
      localStorage.setItem('opennotion-current-studio-document-id', document.id);
      set((state) => ({
        studioDocuments: [document, ...state.studioDocuments.filter((candidate) => candidate.id !== document.id)],
        pages: note ? [...state.pages.filter((page) => page.id !== note.id), note] : state.pages,
        currentStudioDocumentId: document.id,
        workspaceMode: 'studio',
        error: null
      }));
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
      await useAppStore.getState().fetchStudioDocuments();
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
      console.error(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  updatePageOptimistically: (id, updates) => set((state) => ({
    pages: state.pages.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  renamePageAction: async (id, title) => {
    const previousPages = useAppStore.getState().pages;
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, title } : p),
        error: null
      }));
      await updatePage(id, { title });
    } catch (error: unknown) {
      console.error(error);
      const message = userMessageForError(error);
      set({ pages: previousPages, error: message, notice: { kind: 'error', message } });
    }
  },
  removePage: async (id) => {
    try {
      await deletePage(id);
      const pages = await getPages();
      set((state) => ({
        pages,
        currentPageId: resolveCurrentPageId(pages, state.currentPageId)
      }));
      const current = useAppStore.getState().currentPageId;
      localStorage.setItem('opennotion-current-page-id', current || HOME_PAGE_ID);
    } catch (error: unknown) {
      console.error(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
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
      console.error(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      await useAppStore.getState().fetchPages();
    }
  },
  reorderPagesAction: async (parentId, orderedIds) => {
    const previousPages = useAppStore.getState().pages;
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
      console.error(error);
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
      console.error(error);
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
      console.error(error);
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
      console.error(error);
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
      console.error(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setTheme: (theme) => {
    localStorage.setItem('opennotion-theme', theme);
    set({ theme });
  }
}));
