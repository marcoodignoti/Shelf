import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store/useAppStore';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../lib/backup';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import {
  Download,
  SlidersHorizontal,
  Upload,
  UserCircle,
  X,
} from 'lucide-react';

type SettingsSection = 'preferences' | 'data';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const {
    theme,
    setTheme,
    fetchPages,
    showSuccess,
    showError,
  } = useAppStore();
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>('preferences');

  useEffect(() => {
    if (!isOpen) return;

    closeOpenOverlays();
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExport = async () => {
    try {
      const path = await save({
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
    const path = await open({
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

  return createPortal(
    <div className="on-modal-overlay on-settings-overlay items-center justify-center" onMouseDown={onClose}>
      <div className="on-modal-panel on-settings-panel" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="on-settings-sidebar">
          <div className="on-settings-account-card">
            <span className="on-settings-avatar">O</span>
            <div>
              <h2>OpenNotion</h2>
              <p>Local workspace</p>
            </div>
          </div>

          <nav className="on-settings-nav" aria-label="Settings sections">
            <div className="on-settings-nav-group">
              <div className="on-settings-nav-label">Account</div>
              <button className="on-settings-nav-item" type="button">
                <UserCircle className="h-4 w-4" strokeWidth={1.9} />
                Marco
              </button>
            </div>
            <div className="on-settings-nav-group">
              <div className="on-settings-nav-label">Workspace</div>
              <button
                className={`on-settings-nav-item ${activeSection === 'preferences' ? 'on-settings-nav-item-active' : ''}`}
                onClick={() => setActiveSection('preferences')}
              >
                <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
                Preferences
              </button>
              <button
                className={`on-settings-nav-item ${activeSection === 'data' ? 'on-settings-nav-item-active' : ''}`}
                onClick={() => setActiveSection('data')}
              >
                <Download className="h-4 w-4" strokeWidth={1.9} />
                Import / Export
              </button>
            </div>
          </nav>
        </aside>

        <main className="on-settings-main">
          <div className="on-settings-header">
            <button onClick={onClose} className="on-settings-close" aria-label="Close settings">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="on-settings-body">
            {activeSection === 'preferences' && (
              <div className="on-settings-content">
                <div className="on-settings-content-title">
                  <h2>Preferences</h2>
                  <p>Choose how OpenNotion looks and behaves.</p>
                </div>

                <section className="on-settings-group">
                  <h3>Appearance</h3>
                  <div className="on-settings-row">
                    <div className="on-settings-row-copy">
                      <div>Theme</div>
                      <p>Choose a theme for OpenNotion on this device.</p>
                    </div>
                    <select
                      className="on-settings-select"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
                    >
                      <option value="system">Use system setting</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                </section>

                <section className="on-settings-group">
                  <h3>Input options</h3>
                  <div className="on-settings-row">
                    <div className="on-settings-row-copy">
                      <div>Use Enter to add a new line</div>
                      <p>Titles use Enter to move into the page body. Alt + Enter inserts a title line break.</p>
                    </div>
                    <span className="on-settings-pill">Default</span>
                  </div>
                </section>
              </div>
            )}

            {activeSection === 'data' && (
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
            )}

          </div>
        </main>
      </div>
    </div>,
    document.body
  );
}
