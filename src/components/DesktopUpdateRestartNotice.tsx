import { useCallback, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { installDesktopUpdateNow } from "../lib/desktop";
import { useAppStore } from "../store/useAppStore";

export function DesktopUpdateRestartNotice({
  version,
  onDismiss,
}: {
  version: string | null;
  onDismiss: () => void;
}) {
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
        <span>Update ready</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss update notice" title="Dismiss">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="on-beta-update-title">{`OpenNotion${versionLabel} is ready to install`}</div>
      <p>Restart now to finish updating, or keep working and it installs when you quit.</p>
      <button
        type="button"
        className="on-button-secondary on-beta-update-button"
        onClick={() => void handleRestart()}
        disabled={isRestarting}
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
        {isRestarting ? "Restarting" : "Restart to update"}
      </button>
    </aside>
  );
}
