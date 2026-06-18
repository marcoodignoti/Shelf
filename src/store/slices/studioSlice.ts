import type { StateCreator } from 'zustand';
import { getPage, getPages, movePage, createStudioNotePage, type Page } from '../../lib/db';
import {
  StudioDocument,
  StudioDocumentPageLink,
  StudioPanelLayout,
  deleteStudioDocument,
  importStudioDocumentFromDialog,
  listAllStudioDocumentPageLinks,
  listStudioDocuments,
  renameStudioDocument,
  replaceStudioDocumentFileFromDialog,
  updateStudioDocumentViewerState,
} from '../../lib/studio';
import { HOME_PAGE_ID, resolveCurrentPageIdAfterDeletion } from '../../lib/navigation';
import { logStoreError, mergePageMetadataWithHydratedContent, pageTreeIds } from './helpers';
import type { AppState } from '../useAppStore';

export interface StudioSlice {
  studioDocuments: StudioDocument[];
  studioDocumentPageLinks: StudioDocumentPageLink[];
  fetchStudioDocuments: () => Promise<void>;
  importStudioPdfAction: (projectPageId?: string | null) => Promise<StudioDocument | null>;
  replaceStudioPdfAction: (documentId: string) => Promise<StudioDocument | null>;
  updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
  createMissingStudioNoteAction: (documentId: string) => Promise<Page | null>;
  renameStudioDocumentAction: (id: string, title: string) => Promise<void>;
  deleteStudioDocumentAction: (id: string) => Promise<void>;
}

export const createStudioSlice: StateCreator<AppState, [], [], StudioSlice> = (set, get) => ({
  studioDocuments: [],
  studioDocumentPageLinks: [],

  fetchStudioDocuments: async () => {
    try {
      const [studioDocuments, studioDocumentPageLinks] = await Promise.all([
        listStudioDocuments(),
        listAllStudioDocumentPageLinks(),
      ]);
      const linkedPagesById = new Map(studioDocumentPageLinks.map((link) => [link.page_id, link.page]));
      const linkedStudioNotes = studioDocuments
        .map((document) => linkedPagesById.get(document.note_page_id) ?? null)
        .filter((page): page is Page => Boolean(page));
      const missingStudioNoteIds = studioDocuments
        .map((document) => document.note_page_id)
        .filter((pageId) => !linkedPagesById.has(pageId));
      const missingStudioNotes = (await Promise.all(
        missingStudioNoteIds.map(async (pageId) => await getPage(pageId))
      )).filter((page): page is Page => Boolean(page));
      const studioNotes = [...linkedStudioNotes, ...missingStudioNotes];
      set((state) => {
        const currentStudioDocumentId = studioDocuments.some((document) => document.id === state.currentStudioDocumentId)
          ? state.currentStudioDocumentId
          : null;
        const studioNoteIds = new Set(studioNotes.map((page) => page.id));
        const pages = [
          ...state.pages.filter((page) => !studioNoteIds.has(page.id)),
          ...studioNotes,
        ];

        return { studioDocuments, studioDocumentPageLinks, currentStudioDocumentId, pages, error: null };
      });
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
    }
  },
  importStudioPdfAction: async (projectPageId = null) => {
    try {
      const document = await importStudioDocumentFromDialog();
      if (!document) return null;
      if (projectPageId) {
        await movePage(document.note_page_id, projectPageId);
      }
      const pages = await getPages();
      const studioDocumentPageLinks = await listAllStudioDocumentPageLinks();
      const opensInPageTree = document.id === document.note_page_id;
      if (opensInPageTree) {
        localStorage.setItem('opennotion-current-page-id', document.id);
      }
      set((state) => ({
        studioDocuments: [document, ...state.studioDocuments.filter((candidate) => candidate.id !== document.id)],
        studioDocumentPageLinks,
        pages: mergePageMetadataWithHydratedContent(pages, state.pages),
        currentStudioDocumentId: opensInPageTree ? null : document.id,
        currentPageId: opensInPageTree ? document.id : state.currentPageId,
        error: null
      }));
      return document;
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
      return null;
    }
  },
  replaceStudioPdfAction: async (documentId) => {
    try {
      const document = await replaceStudioDocumentFileFromDialog(documentId);
      if (!document) return null;
      set((state) => ({
        studioDocuments: state.studioDocuments.map((candidate) =>
          candidate.id === document.id ? document : candidate
        ),
        currentStudioDocumentId: document.id,
        error: null,
        notice: { kind: 'success', messageKey: 'notice.studioPdfReimported' }
      }));
      return document;
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
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
      logStoreError(error);
      get().showError(error);
      await get().fetchStudioDocuments();
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
        notice: { kind: 'success', messageKey: 'notice.studioLinkedNoteCreated' }
      }));
      return note;
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
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
      logStoreError(error);
      set({ studioDocuments: previousDocuments, pages: previousPages });
      get().showError(error);
    }
  },
  deleteStudioDocumentAction: async (id) => {
    const document = get().studioDocuments.find((candidate) => candidate.id === id);
    if (!document) return;

    try {
      await deleteStudioDocument(id);
      let nextCurrentPageId = HOME_PAGE_ID;
      set((state) => {
        const studioDocuments = state.studioDocuments.filter((candidate) => candidate.id !== id);
        const currentStudioDocumentId = state.currentStudioDocumentId === id
          ? studioDocuments[0]?.id ?? null
          : state.currentStudioDocumentId;
        const deletedPageIds = pageTreeIds(state.pages, document.note_page_id);
        const pages = state.pages.filter((page) => !deletedPageIds.has(page.id));
        nextCurrentPageId = resolveCurrentPageIdAfterDeletion(pages, state.currentPageId, document.note_page_id, deletedPageIds, state.pages);

        return {
          studioDocuments,
          studioDocumentPageLinks: state.studioDocumentPageLinks.filter((link) => link.document_id !== id),
          currentStudioDocumentId,
          currentPageId: nextCurrentPageId,
          pages,
          error: null,
          notice: { kind: 'success', messageKey: 'notice.studioDocumentDeleted' }
        };
      });
      localStorage.setItem('opennotion-current-page-id', nextCurrentPageId || HOME_PAGE_ID);
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
      await get().fetchStudioDocuments();
    }
  },
});
