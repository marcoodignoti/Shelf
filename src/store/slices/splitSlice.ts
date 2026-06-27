import type { StateCreator } from 'zustand';
import type { AppState } from '../useAppStore';

export type SplitPane = 'primary' | 'secondary';

const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;
const SPLIT_RATIO_DEFAULT = 0.5;

const SECONDARY_PAGE_STORAGE_KEY = 'opennotion-secondary-page-id';
const SPLIT_RATIO_STORAGE_KEY = 'opennotion-split-ratio';

export interface SplitSlice {
  secondaryPageId: string | null;
  splitViewRatio: number;
  activePane: SplitPane;
  isSplitPickerOpen: boolean;
  openInSplit: (id: string) => void;
  setSecondaryPageId: (id: string | null) => void;
  setSplitViewRatio: (ratio: number) => void;
  setActivePane: (pane: SplitPane) => void;
  closeSplit: () => void;
  swapSplit: () => void;
  openSplitPicker: () => void;
  closeSplitPicker: () => void;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}

function readStoredRatio(): number {
  if (typeof localStorage === 'undefined') return SPLIT_RATIO_DEFAULT;
  const raw = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
  return raw !== null ? clampRatio(Number(raw)) : SPLIT_RATIO_DEFAULT;
}

function readStoredSecondaryPageId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SECONDARY_PAGE_STORAGE_KEY);
}

export const createSplitSlice: StateCreator<AppState, [], [], SplitSlice> = (set, get) => ({
  secondaryPageId: readStoredSecondaryPageId(),
  splitViewRatio: readStoredRatio(),
  activePane: 'primary',
  isSplitPickerOpen: false,

  openInSplit: (id) => {
    if (id === get().currentPageId) {
      get().closeSplit();
      return;
    }
    localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, id);
    set({ secondaryPageId: id, activePane: 'secondary' });
  },

  setSecondaryPageId: (id) => {
    if (id && id === get().currentPageId) {
      get().closeSplit();
      return;
    }
    if (id) {
      localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(SECONDARY_PAGE_STORAGE_KEY);
    }
    set({ secondaryPageId: id });
  },

  setSplitViewRatio: (ratio) => {
    const clamped = clampRatio(ratio);
    localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(clamped));
    set({ splitViewRatio: clamped });
  },

  setActivePane: (pane) => set({ activePane: pane }),

  closeSplit: () => {
    localStorage.removeItem(SECONDARY_PAGE_STORAGE_KEY);
    set({ secondaryPageId: null, activePane: 'primary' });
  },

  swapSplit: () => {
    const { currentPageId, secondaryPageId } = get();
    if (!secondaryPageId) return;
    if (currentPageId) {
      localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, currentPageId);
      localStorage.setItem('opennotion-current-page-id', secondaryPageId);
    }
    set({ currentPageId: secondaryPageId, secondaryPageId: currentPageId });
  },

  openSplitPicker: () => set({ isSplitPickerOpen: true }),
  closeSplitPicker: () => set({ isSplitPickerOpen: false }),
});
