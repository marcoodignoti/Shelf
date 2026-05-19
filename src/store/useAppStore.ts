import { create } from 'zustand';
import { AppNotice, userMessageForError } from '../lib/appFeedback';
import { Page, getPages, createPage, createPageFromTemplate, deletePage, duplicatePage, movePage, reorderPages, toggleFavorite, toggleTemplate, updatePage } from '../lib/db';
import { HOME_PAGE_ID, resolveCurrentPageId } from '../lib/navigation';

type Theme = 'light' | 'dark' | 'system';

interface AppState {
  pages: Page[];
  currentPageId: string | null;
  isLoading: boolean;
  error: string | null;
  notice: AppNotice | null;
  isCommandPaletteOpen: boolean;
  fetchPages: () => Promise<void>;
  setCurrentPageId: (id: string | null) => void;
  addPage: (title?: string, parentId?: string | null) => Promise<Page | null>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
  renamePageAction: (id: string, title: string) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  movePageAction: (id: string, parentId: string | null) => Promise<void>;
  reorderPagesAction: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
  addPageFromTemplate: (templateId: string, parentId?: string | null) => Promise<Page | null>;
  duplicatePageAction: (sourceId: string) => Promise<Page | null>;
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

export const useAppStore = create<AppState>((set) => ({
  pages: [],
  currentPageId: getStoredPageId(),
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,
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
  setCurrentPageId: (id) => {
    localStorage.setItem('opennotion-current-page-id', id || HOME_PAGE_ID);
    set({ currentPageId: id });
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
  addPage: async (title = 'Untitled', parentId = null) => {
    try {
      const newPage = await createPage(title, parentId);
      localStorage.setItem('opennotion-current-page-id', newPage.id);
      set((state) => ({ pages: [newPage, ...state.pages], currentPageId: newPage.id, error: null }));
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
  addPageFromTemplate: async (templateId, parentId = null) => {
    try {
      const newPage = await createPageFromTemplate(templateId, parentId);
      localStorage.setItem('opennotion-current-page-id', newPage.id);
      set((state) => ({ pages: [newPage, ...state.pages], currentPageId: newPage.id, error: null }));
      return newPage;
    } catch (error: unknown) {
      console.error(error);
      const message = userMessageForError(error);
      set({ error: message, notice: { kind: 'error', message } });
      return null;
    }
  },
  duplicatePageAction: async (sourceId) => {
    try {
      const newPage = await duplicatePage(sourceId);
      localStorage.setItem('opennotion-current-page-id', newPage.id);
      set((state) => ({ pages: [newPage, ...state.pages], currentPageId: newPage.id, error: null }));
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
