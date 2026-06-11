import { useCallback, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { installDesktopUpdateNow } from "../lib/desktop";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";

export function DesktopUpdateRestartNotice({
  version,
  onDismiss,
}: {
  version: string | null;
  onDismiss: () => void;
}) {
  const t = useT();
  const showError = useAppStore((state) => state.showError);
  const [isRestarting, setIsRestarting] = useState(false);

  const handleRestart = useCallback(async () => {
    try {
      setIsRestarting(true);
      await installDesktopUpdateNow();
    } catch (error: unknown) {
      setIsRestarting(false);
      showError(error);
    }
  }, [showError]);

  const versionLabel = version ? ` ${version}` : "";

  return (
    <aside className="on-beta-update" role="status" aria-live="polite">
      <div className="on-beta-update-header">
        <span>{t("desktopUpdate.title")}</span>
        <button type="button" onClick={onDismiss} aria-label={t("desktopUpdate.dismiss")} title={t("desktopUpdate.dismiss")}>
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="on-beta-update-title">{t("desktopUpdate.readyToInstall", { version: versionLabel })}</div>
      <p>{t("desktopUpdate.restartPrompt")}</p>
      <button
        type="button"
        className="on-button-secondary on-beta-update-button"
        onClick={() => void handleRestart()}
        disabled={isRestarting}
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
        {isRestarting ? t("desktopUpdate.restarting") : t("desktopUpdate.restartToUpdate")}
      </button>
    </aside>
  );
}
