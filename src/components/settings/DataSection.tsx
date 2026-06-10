import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../../lib/backup';
import { openDialog, saveDialog } from '../../lib/desktop';
import { useT } from '../../lib/i18n';
import { Download, Upload } from 'lucide-react';

export function DataSection() {
  const t = useT();
  const { fetchPages, showSuccess, showError } = useAppStore();
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const path = await saveDialog({
        defaultPath: `opennotion-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: t('settings.data.backupFilterName'), extensions: ['json'] }],
      });

      if (!path) return;

      const exportedCount = await exportWorkspaceBackup(path);
      const message = t('settings.data.exported', { count: String(exportedCount) });
      setBackupStatus(message);
      showSuccess(message);
    } catch (error: unknown) {
      setBackupStatus(t('settings.data.exportFailed'));
      showError(error);
    }
  };

  const handleImport = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: t('settings.data.backupFilterName'), extensions: ['json'] }],
    });

    if (!path || Array.isArray(path)) return;

    try {
      const importedCount = await importWorkspaceBackup(path);
      await fetchPages();
      const message = t('settings.data.imported', { count: String(importedCount) });
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
        <h2>{t('settings.data.title')}</h2>
        <p>{t('settings.data.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.data.group')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.data.exportRow')}</div>
            <p>{t('settings.data.exportRowDescription')}</p>
          </div>
          <button onClick={handleExport} className="on-button-secondary gap-2">
            <Download className="h-4 w-4" strokeWidth={1.9} />
            {t('settings.data.exportButton')}
          </button>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.data.importRow')}</div>
            <p>{t('settings.data.importRowDescription')}</p>
          </div>
          <button onClick={() => void handleImport()} className="on-button-secondary gap-2">
            <Upload className="h-4 w-4" strokeWidth={1.9} />
            {t('settings.data.importButton')}
          </button>
        </div>
        {backupStatus && (
          <div className="on-settings-status">{backupStatus}</div>
        )}
      </section>
    </div>
  );
}
