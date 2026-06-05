import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../lib/backup';
import { openDialog, saveDialog } from '../lib/desktop';
import { BetaUpdateState, CURRENT_APP_VERSION, checkForBetaUpdate, downloadVerifiedUpdate } from '../lib/betaUpdates';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import {
  Download,
  RefreshCw,
  SlidersHorizontal,
  Upload,
  UserCircle,
  X,
} from 'lucide-react';

type SettingsSection = 'preferences' | 'updates' | 'data';

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
  const [updateState, setUpdateState] = useState<BetaUpdateState>({ status: 'idle' });
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    closeOpenOverlays();
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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

  const handleCheckUpdates = async () => {
    setUpdateState({ status: 'checking' });
    const result = await checkForBetaUpdate();
    setUpdateState(result);

    if (result.status === 'current') {
      showSuccess('OpenNotion is up to date.');
    } else if (result.status === 'error') {
      showError(result.message);
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateState.status !== 'available') return;
    if (!updateState.download) {
      showError('No beta download is available for this platform yet.');
      return;
    }

    try {
      setIsDownloadingUpdate(true);
      await downloadVerifiedUpdate(updateState.download);
      showSuccess('Downloaded and verified update.');
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  const availableUpdate = updateState.status === 'available' ? updateState : null;

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
                className={`on-settings-nav-item ${activeSection === 'updates' ? 'on-settings-nav-item-active' : ''}`}
                onClick={() => setActiveSection('updates')}
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
                Updates
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

            {activeSection === 'updates' && (
              <div className="on-settings-content">
                <div className="on-settings-content-title">
                  <h2>Updates</h2>
                  <p>Check beta builds and verify the matching download for this device.</p>
                </div>

                <section className="on-settings-group">
                  <h3>Beta channel</h3>
                  <div className="on-settings-row">
                    <div className="on-settings-row-copy">
                      <div>Current version</div>
                      <p>Installed build version on this device.</p>
                    </div>
                    <span className="on-settings-pill">{CURRENT_APP_VERSION}</span>
                  </div>
                  <div className="on-settings-row">
                    <div className="on-settings-row-copy">
                      <div>Check for updates</div>
                      <p>Looks for the latest beta manifest published on GitHub Releases.</p>
                    </div>
                    <button
                      onClick={() => void handleCheckUpdates()}
                      className="on-button-secondary gap-2"
                      disabled={updateState.status === 'checking'}
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
                      {updateState.status === 'checking' ? 'Checking' : 'Check'}
                    </button>
                  </div>

                  {availableUpdate && (
                    <div className="on-update-result">
                      <div className="on-update-result-heading">
                        <span>{availableUpdate.manifest.title}</span>
                        <span>{availableUpdate.manifest.version}</span>
                      </div>
                      <p>{availableUpdate.manifest.summary}</p>
                      {availableUpdate.manifest.changes.length > 0 && (
                        <ul>
                          {availableUpdate.manifest.changes.map((change) => (
                            <li key={change}>{change}</li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        className="on-button-secondary gap-2"
                        onClick={() => void handleDownloadUpdate()}
                        disabled={!availableUpdate.download || isDownloadingUpdate}
                      >
                        <Download className="h-4 w-4" strokeWidth={1.9} />
                        {isDownloadingUpdate
                          ? 'Verifying download'
                          : availableUpdate.download
                            ? `Download ${availableUpdate.download.label}`
                            : 'No build for this device'}
                      </button>
                    </div>
                  )}

                  {updateState.status === 'current' && (
                    <div className="on-settings-status">OpenNotion is up to date.</div>
                  )}
                  {updateState.status === 'disabled' && (
                    <div className="on-settings-status">Beta update checks are disabled.</div>
                  )}
                  {updateState.status === 'error' && (
                    <div className="on-settings-status">Update check failed: {updateState.message}</div>
                  )}
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
