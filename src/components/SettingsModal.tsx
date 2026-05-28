import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useAppStore } from '../store/useAppStore';
import { getAllPages, importPages } from '../lib/db';
import { buildBackup, parseBackup, prepareImportedPages } from '../lib/backup';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { Moon, Sun, Monitor, Download, Upload, X } from 'lucide-react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { theme, setTheme, fetchPages, showSuccess, showError } = useAppStore();
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    closeOpenOverlays();
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExport = async () => {
    try {
      const pages = await getAllPages();
      const backup = buildBackup(pages);
      const path = await save({
        defaultPath: `opennotion-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'OpenNotion Backup', extensions: ['json'] }],
      });

      if (!path) return;

      await writeTextFile(path, JSON.stringify(backup, null, 2));
      const message = `Exported ${pages.length} pages.`;
      setBackupStatus(message);
      showSuccess(message);
    } catch (error: unknown) {
      setBackupStatus("Export failed. Please try again.");
      showError(error);
    }
  };

  const handleImport = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'OpenNotion Backup', extensions: ['json'] }],
    });

    if (!path || Array.isArray(path)) return;

    try {
      const backup = parseBackup(await readTextFile(path));
      const importedPages = prepareImportedPages(backup.pages);
      const importedCount = await importPages(importedPages);
      await fetchPages();
      const message = `Imported ${importedCount} pages as duplicates.`;
      setBackupStatus(message);
      showSuccess(message);
    } catch (error: unknown) {
      setBackupStatus(null);
      showError(error);
    }
  };

  return createPortal(
    <div className="on-modal-overlay on-settings-overlay items-center justify-center p-4" onMouseDown={onClose}>
      <div className="on-modal-panel on-settings-panel flex w-full max-w-xl flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <div className="on-settings-header">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Settings</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Preferences and workspace backup.</p>
          </div>
          <button onClick={onClose} className="on-settings-close" aria-label="Close settings">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        
        <div className="on-settings-body">
          
          <div className="on-settings-section">
            <div className="on-settings-section-copy">
              <h3>Appearance</h3>
              <p>Choose how OpenNotion adapts to your device.</p>
            </div>
            
            <div className="on-settings-theme-grid">
              <button 
                className={`on-selectable-tile ${theme === 'light' ? 'on-selectable-tile-active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <Sun className="h-5 w-5" strokeWidth={1.9} />
                <span>Light</span>
              </button>
              
              <button 
                className={`on-selectable-tile ${theme === 'dark' ? 'on-selectable-tile-active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <Moon className="h-5 w-5" strokeWidth={1.9} />
                <span>Dark</span>
              </button>
              
              <button 
                className={`on-selectable-tile ${theme === 'system' ? 'on-selectable-tile-active' : ''}`}
                onClick={() => setTheme('system')}
              >
                <Monitor className="h-5 w-5" strokeWidth={1.9} />
                <span>System</span>
              </button>
            </div>
          </div>

          <div className="on-settings-section">
            <div className="on-settings-section-copy">
              <h3>Data & Privacy</h3>
              <p>Export or import a versioned JSON workspace backup.</p>
            </div>
            
            <div className="on-settings-actions">
              <button 
                onClick={handleExport}
                className="on-button-secondary w-full gap-2"
              >
                <Download className="h-4 w-4" strokeWidth={1.9} />
                Export backup
              </button>
              <button
                onClick={() => void handleImport()}
                className="on-button-secondary w-full gap-2"
              >
                <Upload className="h-4 w-4" strokeWidth={1.9} />
                Import as duplicates
              </button>
            </div>
            {backupStatus && (
              <div className="on-settings-status">
                {backupStatus}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
}
