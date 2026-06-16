import type { StateCreator } from 'zustand';
import { AppNotice, noticeKeyForError } from '../../lib/appFeedback';
import { HOME_PAGE_ID } from '../../lib/navigation';
import type { TranslationKey, TranslationParams } from '../../lib/i18n';
import type { AppState } from '../useAppStore';

export interface SharedSlice {
  currentPageId: string | null;
  currentStudioDocumentId: string | null;
  isLoading: boolean;
  error: string | null;
  notice: AppNotice | null;
  isCommandPaletteOpen: boolean;
  setCurrentPageId: (id: string | null) => void;
  setCurrentStudioDocumentId: (id: string | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  clearNotice: () => void;
  showSuccess: (key: TranslationKey, params?: TranslationParams) => void;
  showError: (error: unknown) => void;
  showErrorKey: (key: TranslationKey, params?: TranslationParams) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export const createSharedSlice: StateCreator<AppState, [], [], SharedSlice> = (set) => ({
  currentPageId: getStoredPageId(),
  currentStudioDocumentId: null,
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,

  setCurrentPageId: (id) => {
    localStorage.setItem('opennotion-current-page-id', id || HOME_PAGE_ID);
    set({ currentPageId: id, currentStudioDocumentId: null });
  },
  setCurrentStudioDocumentId: (id) => {
    set({ currentStudioDocumentId: id });
  },
  setError: (error) => set({ error, notice: error ? { kind: 'error', rawMessage: error } : null }),
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
  showSuccess: (key, params) => set({ notice: { kind: 'success', messageKey: key, params }, error: null }),
  showErrorKey: (key, params) => set({ notice: { kind: 'error', messageKey: key, params }, error: key }),
  showError: (error) => {
    const noticePart = noticeKeyForError(error);
    const notice: AppNotice = { kind: 'error', ...noticePart } as AppNotice;
    const errorText = 'rawMessage' in noticePart ? noticePart.rawMessage : noticePart.messageKey;
    set({ error: errorText, notice });
  },
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
});

function getStoredPageId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-current-page-id') : null;
}
