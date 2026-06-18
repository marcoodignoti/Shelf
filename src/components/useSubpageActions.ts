import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { clampContextMenuPosition } from "../lib/contextMenu";
import type { Page } from "../lib/db";
import { useT, type TranslationKey, type TranslationParams } from "../lib/i18n";
import { CLOSE_OPEN_OVERLAYS_EVENT } from "../lib/overlay";
import type { StudioDocument } from "../lib/studio";

type ShowError = (error: unknown) => void;
type ShowSuccess = (key: TranslationKey, params?: TranslationParams) => void;

type SubpageActionsMenuState = {
  page: Page;
  anchorElement: HTMLElement;
};

type SubpageContextMenuState = {
  page: Page;
  left: number;
  top: number;
};

type UseSubpageActionsOptions = {
  deleteStudioDocumentAction: (id: string) => Promise<void>;
  duplicatePageAction: (sourceId: string, options?: { select?: boolean }) => Promise<Page | null>;
  removePage: (id: string) => Promise<void>;
  showError: ShowError;
  showSuccess: ShowSuccess;
  studioDocuments: StudioDocument[];
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
};

export function useSubpageActions({
  deleteStudioDocumentAction,
  duplicatePageAction,
  removePage,
  showError,
  showSuccess,
  studioDocuments,
  toggleFavoriteAction,
  toggleTemplateAction,
}: UseSubpageActionsOptions) {
  const t = useT();
  const [subpageActionsMenu, setSubpageActionsMenu] = useState<SubpageActionsMenuState | null>(null);
  const [subpageContextMenu, setSubpageContextMenu] = useState<SubpageContextMenuState | null>(null);
  const subpageContextMenuRef = useRef<HTMLDivElement>(null);

  const closeSubpageMenus = useCallback(() => {
    setSubpageActionsMenu(null);
    setSubpageContextMenu(null);
  }, []);

  const handleSubpageContextMenu = useCallback((event: ReactMouseEvent, childPage: Page) => {
    event.preventDefault();
    event.stopPropagation();
    const position = clampContextMenuPosition(
      event.clientX,
      event.clientY,
      window.innerWidth,
      window.innerHeight,
      180,
      150
    );
    setSubpageContextMenu({
      page: childPage,
      left: position.left,
      top: position.top,
    });
  }, []);

  const handleSubpageDelete = useCallback(async (childPage: Page) => {
    closeSubpageMenus();
    try {
      const doc = studioDocuments.find((candidate) => candidate.note_page_id === childPage.id);
      if (doc) {
        await deleteStudioDocumentAction(doc.id);
      } else {
        await removePage(childPage.id);
      }
      showSuccess("editor.pageDeleted", { title: childPage.title || t("sidebar.untitled") });
    } catch (error: unknown) {
      showError(error);
    }
  }, [closeSubpageMenus, deleteStudioDocumentAction, removePage, showError, showSuccess, studioDocuments, t]);

  const handleSubpageDuplicate = useCallback(async (childPage: Page) => {
    closeSubpageMenus();
    try {
      const duplicated = await duplicatePageAction(childPage.id, { select: false });
      if (duplicated) {
        showSuccess("editor.pageDuplicated", { title: childPage.title || t("sidebar.untitled") });
      }
    } catch (error: unknown) {
      showError(error);
    }
  }, [closeSubpageMenus, duplicatePageAction, showError, showSuccess, t]);

  const handleSubpageToggleFavorite = useCallback(async (childPage: Page) => {
    closeSubpageMenus();
    try {
      await toggleFavoriteAction(childPage.id, childPage.is_favorite !== 1);
    } catch (error: unknown) {
      showError(error);
    }
  }, [closeSubpageMenus, showError, toggleFavoriteAction]);

  const handleSubpageToggleTemplate = useCallback(async (childPage: Page) => {
    closeSubpageMenus();
    try {
      await toggleTemplateAction(childPage.id, childPage.is_template !== 1);
    } catch (error: unknown) {
      showError(error);
    }
  }, [closeSubpageMenus, showError, toggleTemplateAction]);

  useEffect(() => {
    if (!subpageContextMenu) return;

    const closeMenu = () => setSubpageContextMenu(null);
    const handleScroll = () => setSubpageContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSubpageContextMenu(null);
    };
    const handleOutsideClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && subpageContextMenuRef.current?.contains(target)) return;
      setSubpageContextMenu(null);
    };

    window.addEventListener("click", handleOutsideClick);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [subpageContextMenu]);

  return {
    handleSubpageContextMenu,
    handleSubpageDelete,
    handleSubpageDuplicate,
    handleSubpageToggleFavorite,
    handleSubpageToggleTemplate,
    setSubpageActionsMenu,
    subpageActionsMenu,
    subpageContextMenu,
    subpageContextMenuRef,
  };
}
