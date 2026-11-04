import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { emptyTrash, listTrashPages, restorePage, type TrashPage } from "../../lib/db";
import { useT } from "../../lib/i18n";
import { useAppStore } from "../../store/useAppStore";

const RETENTION_DAYS = 30;

function daysRemaining(deletedAt: string): number {
  const timestamp = Date.parse(deletedAt);
  if (!Number.isFinite(timestamp)) return RETENTION_DAYS;
  const elapsed = Date.now() - timestamp;
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsed / 86_400_000));
}

export function TrashSection() {
  const t = useT();
  const {
    fetchPages,
    fetchStudioDocuments,
    showError,
    showSuccess,
    updatePageOptimistically,
  } = useAppStore();
  const [items, setItems] = useState<TrashPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmptyConfirming, setIsEmptyConfirming] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setItems(await listTrashPages());
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRestore = async (item: TrashPage) => {
    if (restoringId || isEmptying) return;
    setRestoringId(item.id);
    try {
      const restored = await restorePage(item.id);
      updatePageOptimistically(restored.id, restored);
      await Promise.all([fetchPages(), fetchStudioDocuments()]);
      await refresh();
      showSuccess("trash.restored", { title: restored.title || t("sidebar.untitled") });
    } catch (error: unknown) {
      showError(error);
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmpty = async () => {
    if (isEmptying || restoringId) return;
    setIsEmptying(true);
    try {
      const count = await emptyTrash();
      setIsEmptyConfirming(false);
      await Promise.all([fetchPages(), fetchStudioDocuments()]);
      await refresh();
      showSuccess("trash.emptied", { count: String(count) });
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsEmptying(false);
    }
  };

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t("settings.nav.trash")}</h2>
        <p>{t("trash.description")}</p>
      </div>

      <section className="on-settings-group">
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t("trash.autoDeleteTitle")}</div>
            <p>{t("trash.autoDeleteDescription")}</p>
          </div>
          {isEmptyConfirming ? (
            <div className="flex gap-2">
              <button className="on-button-secondary" disabled={isEmptying} onClick={() => setIsEmptyConfirming(false)}>
                {t("common.cancel")}
              </button>
              <button className="on-button-danger" disabled={isEmptying} onClick={() => void handleEmpty()}>
                {t("trash.emptyConfirm")}
              </button>
            </div>
          ) : (
            <button className="on-button-secondary gap-2" disabled={items.length === 0 || restoringId !== null || isEmptying} onClick={() => setIsEmptyConfirming(true)}>
              <Trash2 className="h-4 w-4" />
              {t("trash.empty")}
            </button>
          )}
        </div>
      </section>

      <section className="on-settings-group">
        <h3>{t("trash.itemsTitle")}</h3>
        {isLoading ? (
          <div className="on-settings-status">{t("common.loadingWorkspace")}</div>
        ) : items.length === 0 ? (
          <div className="on-settings-status">{t("trash.emptyState")}</div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-3 py-3">
                <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.title || t("sidebar.untitled")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("trash.daysRemaining", { count: String(daysRemaining(item.deleted_at)) })}
                    {item.trashed_descendant_count > 1 ? ` · ${t("trash.includesPages", { count: String(item.trashed_descendant_count) })}` : ""}
                  </div>
                </div>
                <button className="on-button-secondary shrink-0 gap-2" disabled={restoringId !== null || isEmptying} onClick={() => void handleRestore(item)}>
                  <RotateCcw className="h-4 w-4" />
                  {t("trash.restore")}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
