import { create } from 'zustand';
import { Page, getPages, createPage, deletePage, toggleFavorite } from '../lib/db';

type Theme = 'light' | 'dark' | 'system';

interface AppState {
  pages: Page[];
  currentPageId: string | null;
  isLoading: boolean;
  error: string | null;
  fetchPages: () => Promise<void>;
  setCurrentPageId: (id: string | null) => void;
  addPage: (title?: string, parentId?: string | null) => Promise<Page | null>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
  removePage: (id: string) => Promise<void>;
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  clearError: () => void;
  setError: (error: string | null) => void;
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useAppStore = create<AppState>((set) => ({
  pages: [],
  currentPageId: null,
  isLoading: true,
  error: null,
  isSidebarOpen: true,
  theme: getStoredTheme(),
  fetchPages: async () => {
    try {
      const pages = await getPages();
      set({ pages, isLoading: false, error: null });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error), isLoading: false });
    }
  },
  setCurrentPageId: (id) => set({ currentPageId: id }),
  clearError: () => set({ error: null }),
  setError: (error) => set({ error }),
  addPage: async (title = 'Untitled', parentId = null) => {
    try {
      const newPage = await createPage(title, parentId);
      set((state) => ({ pages: [newPage, ...state.pages], currentPageId: newPage.id, error: null }));
      return newPage;
    } catch (error: unknown) {
      console.error(error);
      set({ error: getErrorMessage(error) });
      return null;
    }
  },
  updatePageOptimistically: (id, updates) => set((state) => ({
    pages: state.pages.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  removePage: async (id) => {
    try {
      await deletePage(id);
      const pages = await getPages();
      set((state) => ({
        pages,
        currentPageId: pages.some((page) => page.id === state.currentPageId)
          ? state.currentPageId
          : (pages[0]?.id || null)
      }));
    } catch (error: unknown) {
      console.error(error);
      set({ error: getErrorMessage(error) });
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
      set({ error: getErrorMessage(error) });
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
