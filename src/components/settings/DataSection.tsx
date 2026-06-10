import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../../lib/backup';
import { openDialog, saveDialog } from '../../lib/desktop';
import { Download, Upload } from 'lucide-react';

export function DataSection() {
  const { fetchPages, showSuccess, showError } = useAppStore();
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const path = await saveDialog({
        defaultPath: `opennotion-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'OpenNotion Backup', extensions: ['json'] }],
      });

      if (!path) return;

      const exportedCount = await exportWorkspaceBackup(path);
      const message = `Exported ${exportedCount} pages.`;
      setBackupStatus(message);
      showSuccess(message);
    } catch (error: unknown) {
      setBackupStatus("Export failed. Please try again.");
      showError(error);
    }
  };

  const handleImport = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: 'OpenNotion Backup', extensions: ['json'] }],
    });

    if (!path || Array.isArray(path)) return;

    try {
      const importedCount = await importWorkspaceBackup(path);
      await fetchPages();
      const message = `Imported ${importedCount} pages as duplicates.`;
      setBackupStatus(message);
      showSuccess(message);
    } catch (error: unknown) {
      setBackupStatus(null);
      showError(error);
    }
  };

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>Import / Export</h2>
        <p>Export or import a versioned JSON workspace backup.</p>
      </div>

      <section className="on-settings-group">
        <h3>Data & Privacy</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>Export backup</div>
            <p>Creates a local JSON backup of pages and database metadata.</p>
          </div>
          <button onClick={handleExport} className="on-button-secondary gap-2">
            <Download className="h-4 w-4" strokeWidth={1.9} />
            Export
          </button>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>Import as duplicates</div>
            <p>Imports pages without overwriting the current workspace.</p>
          </div>
          <button onClick={() => void handleImport()} className="on-button-secondary gap-2">
            <Upload className="h-4 w-4" strokeWidth={1.9} />
            Import
          </button>
        </div>
        {backupStatus && (
          <div className="on-settings-status">{backupStatus}</div>
        )}
      </section>
    </div>
  );
}
