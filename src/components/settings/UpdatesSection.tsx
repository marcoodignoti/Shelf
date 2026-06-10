import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { BetaUpdateState, CURRENT_APP_VERSION, checkForBetaUpdate, downloadVerifiedUpdate } from '../../lib/betaUpdates';
import { Download, RefreshCw } from 'lucide-react';

export function UpdatesSection() {
  const { showSuccess, showError } = useAppStore();
  const [updateState, setUpdateState] = useState<BetaUpdateState>({ status: 'idle' });
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);

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

  return (
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
  );
}
