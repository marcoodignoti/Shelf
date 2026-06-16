import { create } from 'zustand';
import { invoke, exportFilesWithDialog, importPageFileWithDialog } from '../lib/desktop';
import { prepareImportedPages } from '../lib/backup';
import { buildMarkdownTreeFiles, buildPageTreeExport, sanitizeExportFilename } from '../lib/exportPages';
import { createPageMarkdownRenderer } from '../lib/exportMarkdown';
import { Page, getPage, getPages, createPage, createPageFromTemplate, createProject, createStudioNotePage, deletePage, deleteProject, duplicatePage, movePage, reorderPages, toggleFavorite, toggleTemplate, updatePage } from '../lib/db';
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from '../lib/navigation';
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
import { logStoreError, pageTreeIds } from './slices/helpers';
import { openNotionEditorSchema } from '../lib/editorMath';
import {
	  deleteStudioDocument,
	  importStudioDocumentFromDialog,
	  listAllStudioDocumentPageLinks,
	  listStudioDocuments,
	  renameStudioDocument,
	  replaceStudioDocumentFileFromDialog,
  StudioDocument,
  StudioDocumentPageLink,
  StudioPanelLayout,
  StudioProject,
  updateStudioDocumentViewerState,
} from '../lib/studio';

type CreatePageOptions = { select?: boolean };

export interface AppState extends SharedSlice, ProfileSlice {
  pages: Page[];
  studioDocuments: StudioDocument[];
  studioDocumentPageLinks: StudioDocumentPageLink[];
  fetchPages: () => Promise<void>;
  fetchStudioDocuments: () => Promise<void>;
  importStudioPdfAction: (projectPageId?: string | null) => Promise<StudioDocument | null>;
  replaceStudioPdfAction: (documentId: string) => Promise<StudioDocument | null>;
  updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
  createMissingStudioNoteAction: (documentId: string) => Promise<Page | null>;
  renameStudioDocumentAction: (id: string, title: string) => Promise<void>;
  deleteStudioDocumentAction: (id: string) => Promise<void>;
  importPageAction: () => Promise<Page | null>;
  exportProjectNotesMarkdown: (project: StudioProject) => Promise<void>;
  exportProjectNotesJSON: (project: StudioProject) => Promise<void>;
  createProjectAction: (title?: string) => Promise<Page | null>;
  removeProjectAction: (id: string) => Promise<void>;
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
}

export const useAppStore = create<AppState>()((set, get, ...a) => ({
  ...createSharedSlice(set, get, ...a),
  ...createProfileSlice(set, get, ...a),
  pages: [],
  studioDocuments: [],
  studioDocumentPageLinks: [],
  currentStudioDocumentId: null,
  fetchPages: async () => {
    try {
      const pages = await getPages();
      set((state) => {
        const currentPageId = resolveCurrentPageId(pages, state.currentPageId);
        localStorage.setItem('opennotion-current-page-id', currentPageId);
        return { pages, currentPageId, isLoading: false, error: null };
      });
    } catch (error: unknown) {
      set({ isLoading: false });
      get().showError(error);
    }
  },
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
        pages,
        currentStudioDocumentId: opensInPageTree ? null : document.id,
        currentPageId: opensInPageTree ? document.id : state.currentPageId,
        error: null
      }));
      return document;
    } catch (error: unknown) {
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
      get().showError(error);
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
          get().showSuccess("notice.pageTreeImported");
          return rootPage || null;
        } else if (parsed.version === 1 && Array.isArray(parsed.pages)) {
          await invoke("import_backup_content", { content: raw, importedAt: new Date().toISOString() });
          await get().fetchPages();
          get().showSuccess("notice.workspaceBackupImported");
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
          get().showSuccess("notice.markdownPageImported", { title });
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
        get().showSuccess("notice.projectNoDocuments");
        return;
      }

      const pages = get().pages;
      const rootPages = docs
        .map((doc) => pages.find((p) => p.id === doc.note_page_id))
        .filter((page): page is Page => Boolean(page));
      if (rootPages.length === 0) {
        get().showSuccess("notice.projectNoNotes");
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

      get().showSuccess("notice.projectNotesExportedMarkdown", { path: result.path });
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  exportProjectNotesJSON: async (project) => {
    try {
      const docs = get().studioDocuments.filter((d) => d.project_id === project.id);
      if (docs.length === 0) {
        get().showSuccess("notice.projectNoDocuments");
        return;
      }

      const pages = get().pages;
      const notePageIds = docs.map((d) => d.note_page_id);
      const exportData = buildPageTreeExport(pages, notePageIds, new Date().toISOString());
      const fileName = `${sanitizeExportFilename(project.name)} Notes.json`;
      const result = await exportFilesWithDialog({
        defaultPath: fileName,
        filters: [{ name: "Shelf Page Tree", extensions: ["json"] }],
        files: [{ relativePath: fileName, content: JSON.stringify(exportData, null, 2) }],
      });
      if (!result) return;

      get().showSuccess("notice.projectNotesExportedJSON", { path: result.path });
    } catch (error: unknown) {
      get().showError(error);
    }
  },
  createProjectAction: async (title = 'Untitled') => {
    try {
      const project = await createProject(title);
      set((state) => ({
        pages: [project, ...state.pages.filter((page) => page.id !== project.id)],
        error: null,
      }));
      return project;
    } catch (error: unknown) {
      logStoreError(error);
      get().showError(error);
      return null;
    }
  },
  removeProjectAction: async (id) => {
    const previousPages = get().pages;
    const previousStudioDocumentPageLinks = get().studioDocumentPageLinks;
    const optimisticPages = previousPages
      .filter((page) => page.id !== id)
      .map((page) => page.parent_id === id ? { ...page, parent_id: null } : page);
    const nextCurrentPageId = get().currentPageId === id ? HOME_PAGE_ID : get().currentPageId;

    set({
      pages: optimisticPages,
      currentPageId: nextCurrentPageId,
      error: null,
    });
    localStorage.setItem('opennotion-current-page-id', nextCurrentPageId || HOME_PAGE_ID);

    try {
      await deleteProject(id);
      const [pages, studioDocumentPageLinks] = await Promise.all([
        getPages(),
        listAllStudioDocumentPageLinks(),
      ]);
      set((state) => ({
        pages,
        studioDocumentPageLinks,
        currentPageId: resolveCurrentPageId(pages, state.currentPageId),
      }));
      const current = get().currentPageId;
      localStorage.setItem('opennotion-current-page-id', current || HOME_PAGE_ID);
    } catch (error: unknown) {
      logStoreError(error);
      set({
        pages: previousPages,
        studioDocumentPageLinks: previousStudioDocumentPageLinks,
      });
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
      get().showError(error);
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
      set({ pages: previousPages });
      get().showError(error);
    }
  },
  removePage: async (id) => {
    const previousPages = get().pages;
    const previousStudioDocumentPageLinks = get().studioDocumentPageLinks;
    const deletedIds = pageTreeIds(previousPages, id);
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
      set({
        pages: previousPages,
        studioDocumentPageLinks: previousStudioDocumentPageLinks,
      });
      get().showError(error);
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
      get().showError(error);
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
      set({ pages: previousPages });
      get().showError(error);
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
      get().showError(error);
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
      get().showError(error);
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
      get().showError(error);
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
      get().showError(error);
      return null;
    }
  },

}));
