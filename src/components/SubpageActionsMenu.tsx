import { Copy, Star, Trash2 } from "lucide-react";
import type { Page } from "../lib/db";
import { useT } from "../lib/i18n";

type SubpageActionsMenuProps = {
  page: Page;
  onDuplicate: (page: Page) => void;
  onToggleFavorite: (page: Page) => void;
  onToggleTemplate: (page: Page) => void;
  onDelete: (page: Page) => void;
};

export function SubpageActionsMenu({
  page,
  onDuplicate,
  onToggleFavorite,
  onToggleTemplate,
  onDelete,
}: SubpageActionsMenuProps) {
  const t = useT();

  return (
    <>
      <button
        type="button"
        className="on-menu-item"
        onClick={() => onDuplicate(page)}
      >
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        {t("editor.duplicate")}
      </button>
      <div className="on-menu-separator" />
      <button
        type="button"
        className="on-menu-item"
        onClick={() => onToggleFavorite(page)}
      >
        <Star
          className={`h-3.5 w-3.5 text-muted-foreground ${
            page.is_favorite === 1 ? "fill-current" : ""
          }`}
        />
        {page.is_favorite === 1 ? t("sidebar.contextRemoveFromFavorites") : t("sidebar.contextAddToFavorites")}
      </button>
      <button
        type="button"
        className="on-menu-item"
        onClick={() => onToggleTemplate(page)}
      >
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        {page.is_template === 1 ? t("sidebar.contextRemoveFromTemplates") : t("sidebar.contextUseAsTemplate")}
      </button>
      <div className="on-menu-separator" />
      <button
        type="button"
        className="on-menu-item on-menu-item-danger"
        onClick={() => onDelete(page)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("sidebar.contextDelete")}
      </button>
    </>
  );
}
