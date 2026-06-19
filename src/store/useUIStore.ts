import { create } from 'zustand';
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
import type { SettingsSection } from '../lib/settings';

export type Theme = 'light' | 'dark' | 'system';

interface UIState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  theme: Theme;
  localePreference: LocalePreference;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  pageWidth: PageWidth;
  titleEnterBehavior: TitleEnterBehavior;
  isSettingsWindowOpen: boolean;
  settingsSection: SettingsSection;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openSettingsWindow: (section?: SettingsSection) => void;
  closeSettingsWindow: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  setTheme: (theme: Theme) => void;
  setLocalePreference: (value: LocalePreference) => void;
  setEditorFont: (value: EditorFont) => void;
  setEditorFontSize: (value: EditorFontSize) => void;
  setPageWidth: (value: PageWidth) => void;
  setTitleEnterBehavior: (value: TitleEnterBehavior) => void;
}

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 340;

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function getStoredSidebarWidth(): number {
  const storedWidth = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-sidebar-width') : null);
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredTheme(): Theme {
  const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-theme') : null;
  return isTheme(storedTheme) ? storedTheme : 'system';
}

const getStoredPreference = <T>(key: string, parse: (value: unknown) => T): T =>
  parse(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  theme: getStoredTheme(),
  localePreference: getStoredPreference(PREFERENCE_STORAGE_KEYS.locale, parseLocalePreference),
  editorFont: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFont, parseEditorFont),
  editorFontSize: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFontSize, parseEditorFontSize),
  pageWidth: getStoredPreference(PREFERENCE_STORAGE_KEYS.pageWidth, parsePageWidth),
  titleEnterBehavior: getStoredPreference(PREFERENCE_STORAGE_KEYS.titleEnter, parseTitleEnterBehavior),
  isSettingsWindowOpen: false,
  settingsSection: 'profile',

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarWidth: (width) => {
    const sidebarWidth = clampSidebarWidth(width);
    localStorage.setItem('opennotion-sidebar-width', String(sidebarWidth));
    set({ sidebarWidth });
  },

  openSettingsWindow: (section = 'profile') => {
    set({ isSettingsWindowOpen: true, settingsSection: section });
  },

  closeSettingsWindow: () => {
    set({ isSettingsWindowOpen: false });
  },

  setSettingsSection: (section) => {
    set({ settingsSection: section });
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
