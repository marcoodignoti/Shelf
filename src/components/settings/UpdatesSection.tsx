import { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { BetaUpdateState, CURRENT_APP_VERSION, UpdateDownloadProgress, UpdateDownloadTask, checkForBetaUpdate, startVerifiedUpdateDownload } from '../../lib/betaUpdates';
import { useT } from '../../lib/i18n';
import { Download, RefreshCw, X } from 'lucide-react';
import { UpdateDownloadProgress as UpdateDownloadProgressBar } from '../UpdateDownloadProgress';

function isExpiredUpdateToken(error: unknown): boolean {
  return error instanceof Error && error.message.includes('update download is not linked to a verified manifest');
}

export function UpdatesSection() {
  const t = useT();
  const { showSuccess, showError, showErrorKey } = useAppStore();
  const [updateState, setUpdateState] = useState<BetaUpdateState>({ status: 'idle' });
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const downloadTaskRef = useRef<UpdateDownloadTask | null>(null);

  const handleCheckUpdates = async () => {
    setUpdateState({ status: 'checking' });
    setDownloadProgress(null);
    const result = await checkForBetaUpdate();
    setUpdateState(result);

    if (result.status === 'current') {
      showSuccess('settings.updates.upToDate');
    } else if (result.status === 'error') {
      showError(result.message);
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateState.status !== 'available') return;
    if (!updateState.download) {
      showErrorKey('settings.updates.noPlatformDownload');
      return;
    }

    try {
      setIsDownloadingUpdate(true);
      setDownloadProgress(null);
      const task = startVerifiedUpdateDownload(updateState.download, setDownloadProgress);
      downloadTaskRef.current = task;
      await task.promise;
      showSuccess('settings.updates.downloaded');
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Update download cancelled') {
        setDownloadProgress(null);
        showSuccess('settings.updates.cancelled');
      } else if (isExpiredUpdateToken(error)) {
        const refreshed = await checkForBetaUpdate();
        setUpdateState(refreshed);
        if (refreshed.status === 'available' && refreshed.download) {
          setDownloadProgress(null);
          try {
            const retryTask = startVerifiedUpdateDownload(refreshed.download, setDownloadProgress);
            downloadTaskRef.current = retryTask;
            await retryTask.promise;
            showSuccess('settings.updates.downloaded');
          } catch (retryError: unknown) {
            if (retryError instanceof Error && retryError.message === 'Update download cancelled') {
              setDownloadProgress(null);
              showSuccess('settings.updates.cancelled');
            } else {
              showError(retryError);
            }
          }
        } else {
          showError(error);
        }
      } else {
        showError(error);
      }
    } finally {
      downloadTaskRef.current = null;
      setIsDownloadingUpdate(false);
    }
  };

  const handleCancelDownload = async () => {
    await downloadTaskRef.current?.cancel();
  };

  const availableUpdate = updateState.status === 'available' ? updateState : null;

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.updates.title')}</h2>
        <p>{t('settings.updates.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.updates.group')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.updates.currentVersion')}</div>
            <p>{t('settings.updates.currentVersionDescription')}</p>
          </div>
          <span className="on-settings-pill">{CURRENT_APP_VERSION}</span>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.updates.checkRow')}</div>
            <p>{t('settings.updates.checkRowDescription')}</p>
          </div>
          <button
            onClick={() => void handleCheckUpdates()}
            className="on-button-secondary gap-2"
            disabled={updateState.status === 'checking'}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
            {updateState.status === 'checking' ? t('settings.updates.checking') : t('settings.updates.check')}
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
            <div className="on-update-actions">
              <button
                type="button"
                className="on-button-secondary gap-2"
                onClick={() => void handleDownloadUpdate()}
                disabled={!availableUpdate.download || isDownloadingUpdate}
              >
                <Download className="h-4 w-4" strokeWidth={1.9} />
                {isDownloadingUpdate
                  ? t('settings.updates.verifying')
                  : availableUpdate.download
                    ? t('settings.updates.download', { label: availableUpdate.download.label })
                    : t('settings.updates.noBuild')}
              </button>
              {isDownloadingUpdate && (
                <button type="button" className="on-button-secondary gap-2" onClick={() => void handleCancelDownload()}>
                  <X className="h-4 w-4" strokeWidth={1.9} />
                  {t('settings.updates.cancel')}
                </button>
              )}
            </div>
            <UpdateDownloadProgressBar progress={downloadProgress} />
          </div>
        )}

        {updateState.status === 'current' && (
          <div className="on-settings-status">{t('settings.updates.upToDate')}</div>
        )}
        {updateState.status === 'disabled' && (
          <div className="on-settings-status">{t('settings.updates.disabled')}</div>
        )}
        {updateState.status === 'error' && (
          <div className="on-settings-status">{t('settings.updates.checkFailed', { message: updateState.message })}</div>
        )}
      </section>
    </div>
  );
}
