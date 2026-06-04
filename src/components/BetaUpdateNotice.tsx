import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { openExternalUrl } from "../lib/desktop";
import { BetaUpdateState, checkForBetaUpdate, dismissedUpdateKey } from "../lib/betaUpdates";
import { useAppStore } from "../store/useAppStore";

const AUTO_CHECK_DELAY_MS = 1_500;

function hasDismissedUpdate(version: string): boolean {
  try {
    return window.localStorage.getItem(dismissedUpdateKey(version)) === "1";
  } catch {
    return false;
  }
}

function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(dismissedUpdateKey(version), "1");
  } catch {
    // Ignore localStorage failures. Dismissal is only a UI preference.
  }
}

export function BetaUpdateNotice() {
  const showError = useAppStore((state) => state.showError);
  const [state, setState] = useState<BetaUpdateState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void checkForBetaUpdate().then((result) => {
        if (cancelled) return;
        if (result.status !== "available") return;
        if (hasDismissedUpdate(result.manifest.version)) return;
        setState(result);
      });
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (state.status !== "available") return;
    dismissUpdate(state.manifest.version);
    setState({ status: "idle" });
  }, [state]);

  const handleDownload = useCallback(async () => {
    if (state.status !== "available") return;
    if (!state.download) {
      showError("No beta download is available for this platform yet.");
      return;
    }

    try {
      await openExternalUrl(state.download.url);
    } catch (error: unknown) {
      showError(error);
    }
  }, [showError, state]);

  if (state.status !== "available") return null;

  const { manifest, download } = state;

  return (
    <aside className="on-beta-update" role="status" aria-live="polite">
      <div className="on-beta-update-header">
        <span>Beta update</span>
        <button type="button" onClick={handleDismiss} aria-label="Dismiss beta update" title="Dismiss">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="on-beta-update-title">{manifest.title}</div>
      <p>{manifest.summary}</p>
      {manifest.changes.length > 0 && (
        <ul className="on-beta-update-list">
          {manifest.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
      <button type="button" className="on-button-secondary on-beta-update-button" onClick={() => void handleDownload()}>
        <Download className="h-4 w-4" strokeWidth={1.9} />
        {download ? `Download ${manifest.version}` : "No build for this device"}
      </button>
      {download?.size && <div className="on-beta-update-size">{download.label} - {download.size}</div>}
    </aside>
  );
}
