import { useCallback, useEffect, useMemo, useState } from "react";
import { getAllPages, type Page } from "../lib/db";
import { defaultDatabaseSchema } from "../lib/database";
import { exportFilesWithDialog } from "../lib/desktop";
import { createPageMarkdownRenderer } from "../lib/exportMarkdown";
import { buildMarkdownTreeFiles, buildPageTreeExport, mergePagesForExport, sanitizeExportFilename } from "../lib/exportPages";
import { movableEditorPageTargets } from "../lib/editorPageCollections";
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from "../lib/overlay";
import type { StudioDocument } from "../lib/studio";
import type { TranslationKey, TranslationParams } from "../lib/i18n";

type QueueSave = (updates: Partial<Page>) => void;
type ShowError = (error: unknown) => void;
type ShowSuccess = (key: TranslationKey, params?: TranslationParams) => void;

type UsePageActionsOptions = {
  childPages: Page[];
  closePageMenu: () => void;
  deleteStudioDocumentAction: (id: string) => Promise<void>;
  duplicatePageAction: (sourceId: string, options?: { select?: boolean }) => Promise<Page | null>;
  movePageAction: (id: string, parentId: string | null) => Promise<void>;
  onSelectPage: (id: string) => void;
  page: Page;
  pages: Page[];
  queueSave: QueueSave;
  removePage: (id: string) => Promise<void>;
  showError: ShowError;
  showSuccess: ShowSuccess;
  studioDocuments: StudioDocument[];
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
};

export function usePageActions({
  childPages,
  closePageMenu,
  deleteStudioDocumentAction,
  duplicatePageAction,
  movePageAction,
  onSelectPage,
  page,
  pages,
  queueSave,
  removePage,
  showError,
  showSuccess,
  studioDocuments,
  toggleFavoriteAction,
  toggleTemplateAction,
}: UsePageActionsOptions) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const movablePages = useMemo(() => movableEditorPageTargets(pages, page.id, moveQuery), [moveQuery, page.id, pages]);

  useEffect(() => {
    setMoveMenuOpen(false);
    setMoveQuery("");
    setIsDeleteConfirmOpen(false);
  }, [page.id]);

  useEffect(() => {
    if (!isDeleteConfirmOpen) return;

    closeOpenOverlays();
    const closeDialog = () => setIsDeleteConfirmOpen(false);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeDialog);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeDialog);
  }, [isDeleteConfirmOpen]);

  const handleToggleFavorite = useCallback(async () => {
    closePageMenu();
    await toggleFavoriteAction(page.id, page.is_favorite !== 1);
  }, [closePageMenu, page.id, page.is_favorite, toggleFavoriteAction]);

  const handleToggleTemplate = useCallback(async () => {
    closePageMenu();
    await toggleTemplateAction(page.id, page.is_template !== 1);
  }, [closePageMenu, page.id, page.is_template, toggleTemplateAction]);

  const handleTurnIntoDatabase = useCallback(() => {
    closePageMenu();
    queueSave({
      is_database: 1,
      database_schema: JSON.stringify(defaultDatabaseSchema()),
    });
  }, [closePageMenu, queueSave]);

  const handleExportMarkdown = useCallback(async () => {
    closePageMenu();
    try {
      const isFolderExport = childPages.length > 0;
      const exportPages = mergePagesForExport(await getAllPages(), pages);
      const exportPage = exportPages.find((candidate) => candidate.id === page.id) ?? page;
      const renderPageMarkdown = await createPageMarkdownRenderer();
      const files = await buildMarkdownTreeFiles(exportPages, [exportPage], renderPageMarkdown, { flattenSingleRoot: true });
      const result = await exportFilesWithDialog({
        defaultPath: `${sanitizeExportFilename(page.title || "Untitled")}.md`,
        filters: [{ name: isFolderExport ? "Markdown Folder Structure" : "Markdown Document", extensions: ["md"] }],
        files,
      });
      if (!result) return;
      showSuccess(
        isFolderExport ? "editor.exportedMarkdownFolder" : "editor.exportedMarkdownFile",
        { path: result.path }
      );
    } catch (error: unknown) {
      showError(error);
    }
  }, [childPages.length, closePageMenu, page, pages, showError, showSuccess]);

  const handleExportJSON = useCallback(async () => {
    closePageMenu();
    try {
      const exportPages = mergePagesForExport(await getAllPages(), pages);
      const exportData = buildPageTreeExport(exportPages, [page.id], new Date().toISOString());
      const fileName = `${sanitizeExportFilename(page.title || "Untitled")}.json`;
      const result = await exportFilesWithDialog({
        defaultPath: fileName,
        filters: [{ name: "Shelf Page Tree", extensions: ["json"] }],
        files: [{ relativePath: fileName, content: JSON.stringify(exportData, null, 2) }],
      });
      if (!result) return;
      showSuccess("editor.exportedJSON", { path: result.path });
    } catch (error: unknown) {
      showError(error);
    }
  }, [closePageMenu, page.id, page.title, pages, showError, showSuccess]);

  const handleDuplicatePage = useCallback(async () => {
    closePageMenu();
    const duplicated = await duplicatePageAction(page.id);
    if (duplicated) {
      onSelectPage(duplicated.id);
    }
  }, [closePageMenu, duplicatePageAction, onSelectPage, page.id]);

  const handleOpenMoveMenu = useCallback(() => {
    closePageMenu();
    setMoveMenuOpen(true);
    setMoveQuery("");
  }, [closePageMenu]);

  const handleMovePage = useCallback(async (parentId: string | null) => {
    await movePageAction(page.id, parentId);
    setMoveMenuOpen(false);
    setMoveQuery("");
  }, [movePageAction, page.id]);

  const handleRequestDelete = useCallback(() => {
    closePageMenu();
    setIsDeleteConfirmOpen(true);
  }, [closePageMenu]);

  const handleConfirmDelete = useCallback(async () => {
    const doc = studioDocuments.find((candidate) => candidate.note_page_id === page.id);
    if (doc) {
      await deleteStudioDocumentAction(doc.id);
    } else {
      await removePage(page.id);
    }
    setIsDeleteConfirmOpen(false);
  }, [deleteStudioDocumentAction, page.id, removePage, studioDocuments]);

  return {
    handleConfirmDelete,
    handleDuplicatePage,
    handleExportJSON,
    handleExportMarkdown,
    handleMovePage,
    handleOpenMoveMenu,
    handleRequestDelete,
    handleToggleFavorite,
    handleToggleTemplate,
    handleTurnIntoDatabase,
    isDeleteConfirmOpen,
    movablePages,
    moveMenuOpen,
    moveQuery,
    setIsDeleteConfirmOpen,
    setMoveMenuOpen,
    setMoveQuery,
  };
}
