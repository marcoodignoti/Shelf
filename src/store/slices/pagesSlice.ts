import type { StateCreator } from 'zustand';
import { exportFilesWithDialog, importPageFileWithDialog } from '../../lib/desktop';
import { prepareImportedPages } from '../../lib/backup';
import { buildMarkdownTreeFiles, buildPageTreeExport, mergePagesForExport, parsePageTreeExport, sanitizeExportFilename } from '../../lib/exportPages';
import { createPageMarkdownRenderer } from '../../lib/exportMarkdown';
import {
  Page,
  getAllPages, getPages, createPage, createPageFromTemplate, createProject,
  deletePage, deleteProject, duplicatePage, movePage, reorderPages,
  importBackupContent, importPages, toggleFavorite, toggleTemplate, updatePage,
} from '../../lib/db';
import { StudioProject, listAllStudioDocumentPageLinks } from '../../lib/studio';
import { openNotionEditorSchema } from '../../lib/editorMath';
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from '../../lib/navigation';
import { logStoreError, mergePageMetadataWithHydratedContent, pageTreeIds } from './helpers';
import type { AppState } from '../useAppStore';

export interface PagesSlice {
  pages: Page[];
  fetchPages: () => Promise<void>;
  addPage: (title?: string, parentId?: string | null, options?: { select?: boolean }) => Promise<Page | null>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
  renamePageAction: (id: string, title: string) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  movePageAction: (id: string, parentId: string | null) => Promise<void>;
  reorderPagesAction: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
  addPageFromTemplate: (templateId: string, parentId?: string | null, options?: { select?: boolean }) => Promise<Page | null>;
  duplicatePageAction: (sourceId: string, options?: { select?: boolean }) => Promise<Page | null>;
  importPageAction: () => Promise<Page | null>;
  createProjectAction: (title?: string) => Promise<Page | null>;
  removeProjectAction: (id: string) => Promise<void>;
  exportProjectNotesMarkdown: (project: StudioProject) => Promise<void>;
  exportProjectNotesJSON: (project: StudioProject) => Promise<void>;
}

function parseImportedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const createPagesSlice: StateCreator<AppState, [], [], PagesSlice> = (set, get) => ({
  pages: [],

  fetchPages: async () => {
    try {
      const pages = await getPages();
      set((state) => {
        const mergedPages = mergePageMetadataWithHydratedContent(pages, state.pages);
        const currentPageId = resolveCurrentPageId(mergedPages, state.currentPageId);
        localStorage.setItem('opennotion-current-page-id', currentPageId);
        return { pages: mergedPages, currentPageId, isLoading: false, error: null };
      });
    } catch (error: unknown) {
      set({ isLoading: false });
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
    pages: state.pages.map(p => p.id === id ? {
      ...p,
      ...updates,
      content_loaded: Object.prototype.hasOwnProperty.call(updates, 'content') ? 1 : p.content_loaded,
    } : p)
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
      currentPageId: resolveCurrentPageIdAfterDeletion(optimisticPages, state.currentPageId, id, deletedIds, previousPages),
      // Auto-close the split view if either pane's page is being deleted.
      secondaryPageId: deletedIds.has(state.currentPageId ?? "") || deletedIds.has(state.secondaryPageId ?? "")
        ? null
        : state.secondaryPageId,
      activePane: deletedIds.has(state.currentPageId ?? "") || deletedIds.has(state.secondaryPageId ?? "")
        ? "primary"
        : state.activePane,
    }));
    if (deletedIds.has(get().currentPageId ?? "") || deletedIds.has(get().secondaryPageId ?? "")) {
      localStorage.removeItem('opennotion-secondary-page-id');
    }

    try {
      await deletePage(id);
      const [pages, studioDocumentPageLinks] = await Promise.all([
        getPages(),
        listAllStudioDocumentPageLinks(),
      ]);
      set((state) => ({
        pages: mergePageMetadataWithHydratedContent(pages, state.pages),
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
    const previousPages = get().pages;
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, is_favorite: isFavorite ? 1 : 0 } : p)
      }));
      await toggleFavorite(id, isFavorite);
    } catch (error: unknown) {
      logStoreError(error);
      set({ pages: previousPages });
      get().showError(error);
    }
  },
  toggleTemplateAction: async (id, isTemplate) => {
    const previousPages = get().pages;
    try {
      set((state) => ({
        pages: state.pages.map(p => p.id === id ? { ...p, is_template: isTemplate ? 1 : 0 } : p)
      }));
      await toggleTemplate(id, isTemplate);
    } catch (error: unknown) {
      logStoreError(error);
      set({ pages: previousPages });
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
  importPageAction: async () => {
    try {
      const imported = await importPageFileWithDialog({
        multiple: false,
        filters: [{ name: "Page Export (.json, .md)", extensions: ["json", "md"] }],
      });
      if (!imported) return null;
      const { path: filePath, content: raw } = imported;
      if (filePath.endsWith(".json")) {
        const parsed = parseImportedJson(raw);

        if (isRecord(parsed) && parsed.type === "page_tree") {
          const pageTreeExport = parsePageTreeExport(raw);
          const pages = prepareImportedPages(pageTreeExport.pages);
          const rootPage = pages.find((p) => p.id === pageTreeExport.root_page_id || !p.parent_id);
          if (rootPage) {
            rootPage.parent_id = null;
          }
          await importPages(pages);
          await get().fetchPages();
          get().showSuccess("notice.pageTreeImported");
          return rootPage || null;
        } else if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.pages)) {
          await importBackupContent(raw);
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
        pages: mergePageMetadataWithHydratedContent(pages, state.pages),
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
  exportProjectNotesMarkdown: async (project) => {
    try {
      const docs = get().studioDocuments.filter((d) => d.project_id === project.id);
      if (docs.length === 0) {
        get().showSuccess("notice.projectNoDocuments");
        return;
      }

      const currentPages = get().pages;
      const pages = mergePagesForExport(await getAllPages(), currentPages);
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

      const pages = mergePagesForExport(await getAllPages(), get().pages);
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
});
