import type { UpdateDownloadProgress as UpdateDownloadProgressState } from "../lib/betaUpdates";
import { useT } from "../lib/i18n";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return "<1 min";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

interface UpdateDownloadProgressProps {
  progress: UpdateDownloadProgressState | null;
}

export function UpdateDownloadProgress({ progress }: UpdateDownloadProgressProps) {
  const t = useT();
  if (!progress) return null;

  const percent = progress.percent === null ? null : Math.round(progress.percent);
  const width = progress.percent === null ? 100 : Math.max(2, Math.min(100, progress.percent));
  const received = formatBytes(progress.bytes);
  const total = progress.totalBytes ? formatBytes(progress.totalBytes) : null;
  const eta = formatEta(progress.estimatedSecondsRemaining);
  const label = progress.status === "verifying"
    ? t("settings.updates.verifying")
    : percent !== null && total
      ? t("settings.updates.downloadProgress", { percent: String(percent), received, total })
      : t("settings.updates.downloadProgressUnknown", { received });

  return (
    <div className="on-update-progress">
      <div className="on-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} {...(percent !== null ? { "aria-valuenow": percent } : {})}>
        <span className="on-update-progress-fill" style={{ width: `${width}%` }} />
      </div>
      <div className="on-update-progress-meta">
        <span>{label}</span>
        {eta && progress.status === "downloading" && <span>{t("settings.updates.eta", { eta })}</span>}
      </div>
    </div>
  );
}
