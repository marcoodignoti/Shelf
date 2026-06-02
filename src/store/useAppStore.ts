import { create } from 'zustand';
import { open } from '@tauri-apps/plugin-dialog';
import { AppNotice, userMessageForError } from '../lib/appFeedback';
import {
  AiChatStoredMessage,
  AiConversationSummary,
  AiChatRequestOptions,
  AiModelInfo,
  AiSettings,
  AI_MODELS,
  AI_PROVIDER_OPENROUTER,
  clearAiApiKey,
  createAiConversation,
  deleteAiConversation,
  getAiConversation,
  getAiModels,
  getAiSettings,
  listAiConversations,
  renameAiConversation,
  saveAiApiKey,
  streamAiChatReply,
  updateAiSettings
} from '../lib/ai';
import { Page, getPage, getPages, createPage, createPageFromTemplate, createStudioNotePage, deletePage, duplicatePage, movePage, reorderPages, toggleFavorite, toggleTemplate, updatePage } from '../lib/db';
import { HOME_PAGE_ID, resolveCurrentPageId } from '../lib/navigation';
import {
  createStudioProject,
  deleteStudioDocument,
  deleteStudioProject,
  importStudioDocument,
  listStudioDocuments,
  listStudioProjects,
  renameStudioDocument,
  renameStudioProject,
  replaceStudioDocumentFile,
  StudioDocument,
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
  isAiActionModalOpen: boolean;
  aiSettings: AiSettings | null;
  aiModels: AiModelInfo[];
  workspaceMode: WorkspaceMode;
  studioDocuments: StudioDocument[];
  studioProjects: StudioProject[];
  currentStudioDocumentId: string | null;
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
  openAiActionModal: () => void;
  closeAiActionModal: () => void;
  aiConversations: AiConversationSummary[];
  activeConversationId: string | null;
  aiMessages: AiChatStoredMessage[];
  streamingMessageId: string | null;
  fetchAiConversations: () => Promise<void>;
  openAiConversation: (id: string) => Promise<void>;
  newAiConversation: () => Promise<string>;
  renameAiConversationAction: (id: string, title: string) => Promise<void>;
  deleteAiConversationAction: (id: string) => Promise<void>;
  sendAiChatMessage: (prompt: string, currentPageId: string | null, options?: AiChatRequestOptions) => Promise<AiChatStoredMessage | null>;
  regenerateAiChat: (currentPageId: string | null, options?: AiChatRequestOptions) => Promise<AiChatStoredMessage | null>;
  fetchAiSettings: () => Promise<void>;
  fetchAiModels: () => Promise<void>;
  updateAiSettingsAction: (settings: Pick<AiSettings, 'provider' | 'model' | 'trusted_mode_enabled'>) => Promise<void>;
  saveAiApiKeyAction: (apiKey: string) => Promise<void>;
  clearAiApiKeyAction: () => Promise<void>;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  theme: Theme;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTheme: (theme: Theme) => void;
}

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 240;

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

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function getStoredSidebarWidth(): number {
  const storedWidth = Number(localStorage.getItem('opennotion-sidebar-width'));
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
}

function logStoreError(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(error);
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  pages: [],
  currentPageId: getStoredPageId(),
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,
  isAiActionModalOpen: false,
  aiSettings: null,
  aiModels: [...AI_MODELS],
  workspaceMode: getStoredWorkspaceMode(),
  studioDocuments: [],
  studioProjects: [],
  currentStudioDocumentId: getStoredStudioDocumentId(),
  aiConversations: [],
  activeConversationId: null,
  aiMessages: [],
  streamingMessageId: null,
  isSidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
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
      const [studioDocuments, studioProjects] = await Promise.all([
        listStudioDocuments(),
        listStudioProjects(),
      ]);
      const studioNotes = (await Promise.all(
        studioDocuments.map(async (document) => {
          const note = await getPage(document.note_page_id);
          if (note) return note;
          return await createStudioNotePage(document.note_page_id, `${document.title} Notes`);
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

        return { studioDocuments, studioProjects, currentStudioDocumentId, pages, error: null };
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
  openAiActionModal: () => set({ isAiActionModalOpen: true, isCommandPaletteOpen: false }),
  closeAiActionModal: () => set({ isAiActionModalOpen: false }),
  fetchAiSettings: async () => {
    try {
      set({ aiSettings: await getAiSettings() });
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  fetchAiModels: async () => {
    try {
      set({ aiModels: await getAiModels() });
    } catch (error: unknown) {
      logStoreError(error);
      set({ aiModels: [...AI_MODELS] });
    }
  },
  updateAiSettingsAction: async (settings) => {
    try {
      set({ aiSettings: await updateAiSettings(settings) });
      get().showSuccess('AI settings updated.');
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  saveAiApiKeyAction: async (apiKey) => {
    try {
      set({ aiSettings: await saveAiApiKey(AI_PROVIDER_OPENROUTER, apiKey) });
      get().showSuccess('AI API key saved.');
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  clearAiApiKeyAction: async () => {
    try {
      set({ aiSettings: await clearAiApiKey(AI_PROVIDER_OPENROUTER) });
      get().showSuccess('AI API key removed.');
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  importStudioPdfAction: async (projectId = null) => {
    try {
      const path = await open({
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
      localStorage.setItem('opennotion-workspace-mode', 'studio');
      localStorage.setItem('opennotion-current-studio-document-id', document.id);
      set((state) => ({
        studioDocuments: [importedDocument, ...state.studioDocuments.filter((candidate) => candidate.id !== document.id)],
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
      const path = await open({
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
    try {
      await deletePage(id);
      const pages = await getPages();
      set((state) => ({
        pages,
        currentPageId: resolveCurrentPageId(pages, state.currentPageId)
      }));
      const current = get().currentPageId;
      localStorage.setItem('opennotion-current-page-id', current || HOME_PAGE_ID);
    } catch (error: unknown) {
      logStoreError(error);
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

  fetchAiConversations: async () => {
    try {
      set({ aiConversations: await listAiConversations() });
    } catch (error: unknown) {
      get().showError(error);
    }
  },

  openAiConversation: async (id) => {
    try {
      const detail = await getAiConversation(id);
      set({ activeConversationId: id, aiMessages: detail.messages, streamingMessageId: null });
    } catch (error: unknown) {
      get().showError(error);
    }
  },

  newAiConversation: async () => {
    const convo = await createAiConversation();
    set((state) => ({
      aiConversations: [convo, ...state.aiConversations],
      activeConversationId: convo.id,
      aiMessages: [],
      streamingMessageId: null,
    }));
    return convo.id;
  },

  renameAiConversationAction: async (id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const previous = get().aiConversations;
    const updated_at = new Date().toISOString();
    set({ aiConversations: previous.map((c) => (c.id === id ? { ...c, title: trimmedTitle, updated_at } : c)) });
    try {
      await renameAiConversation(id, trimmedTitle);
    } catch (error: unknown) {
      set({ aiConversations: previous });
      get().showError(error);
    }
  },

  deleteAiConversationAction: async (id) => {
    const previous = get().aiConversations;
    const previousActiveId = get().activeConversationId;
    const previousMessages = get().aiMessages;
    set((state) => ({
      aiConversations: previous.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
      aiMessages: state.activeConversationId === id ? [] : state.aiMessages,
      streamingMessageId: state.activeConversationId === id ? null : state.streamingMessageId,
    }));
    try {
      await deleteAiConversation(id);
    } catch (error: unknown) {
      set({ aiConversations: previous, activeConversationId: previousActiveId, aiMessages: previousMessages });
      get().showError(error);
    }
  },

  sendAiChatMessage: async (prompt, currentPageId, options = {}) => {
    const settings = get().aiSettings;
    if (!settings) {
      get().showError(new Error('AI settings are still loading.'));
      return null;
    }
    if (!settings.has_api_key) {
      get().showError(new Error('Missing AI API key'));
      return null;
    }
    let conversationId = get().activeConversationId;
    if (!conversationId) conversationId = await get().newAiConversation();

    const userId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    const created_at = new Date().toISOString();
    set((state) => ({
      aiMessages: [
        ...state.aiMessages,
        { id: userId, role: "user" as const, content: prompt, created_at },
        { id: assistantId, role: "assistant" as const, content: "", created_at },
      ],
      streamingMessageId: assistantId,
    }));

    try {
      const saved = await streamAiChatReply(
        {
          conversation_id: conversationId,
          prompt,
          provider: settings.provider,
          model: settings.model,
          current_page_id: currentPageId,
          ...options,
        },
        (delta) => {
          set((state) => ({
            aiMessages: state.aiMessages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m
            ),
          }));
        }
      );
      const detail = await getAiConversation(conversationId);
      const persistedAssistant = detail.messages.find((message) => message.id === saved.id) ?? saved;
      set((state) => ({
        activeConversationId: conversationId,
        aiMessages: detail.messages.length > 0
          ? detail.messages
          : state.aiMessages.map((m) => (m.id === assistantId ? saved : m)),
        streamingMessageId: null,
      }));
      void get().fetchAiConversations();
      return persistedAssistant;
    } catch (error: unknown) {
      const cancelled = String(error).toLowerCase().includes('cancelled');
      set((state) => ({
        aiMessages: state.aiMessages.filter((m) => m.id !== assistantId),
        streamingMessageId: null,
      }));
      if (!cancelled) get().showError(error);
      return null;
    }
  },

  regenerateAiChat: async (currentPageId, options = {}) => {
    const settings = get().aiSettings;
    const conversationId = get().activeConversationId;
    if (!settings || !conversationId) return null;
    if (!settings.has_api_key) {
      get().showError(new Error('Missing AI API key'));
      return null;
    }
    const messages = get().aiMessages;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return null;

    const assistantId = `local-assistant-${Date.now()}`;
    const created_at = new Date().toISOString();
    set((state) => {
      const lastId = state.aiMessages[state.aiMessages.length - 1]?.id;
      return {
        aiMessages: [
          ...state.aiMessages.filter((m) => !(m.role === "assistant" && m.id === lastId)),
          { id: assistantId, role: "assistant" as const, content: "", created_at },
        ],
        streamingMessageId: assistantId,
      };
    });

    try {
      const saved = await streamAiChatReply(
        {
          conversation_id: conversationId,
          prompt: lastUser.content,
          provider: settings.provider,
          model: settings.model,
          current_page_id: currentPageId,
          regenerate: true,
          ...options,
        },
        (delta) => {
          set((state) => ({
            aiMessages: state.aiMessages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m
            ),
          }));
        }
      );
      const detail = await getAiConversation(conversationId);
      const persistedAssistant = detail.messages.find((message) => message.id === saved.id) ?? saved;
      set((state) => ({
        aiMessages: detail.messages.length > 0
          ? detail.messages
          : state.aiMessages.map((m) => (m.id === assistantId ? saved : m)),
        streamingMessageId: null,
      }));
      void get().fetchAiConversations();
      return persistedAssistant;
    } catch (error: unknown) {
      const cancelled = String(error).toLowerCase().includes('cancelled');
      set((state) => ({
        aiMessages: state.aiMessages.filter((m) => m.id !== assistantId),
        streamingMessageId: null,
      }));
      if (!cancelled) get().showError(error);
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
  }
}));
