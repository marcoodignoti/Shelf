import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useAppStore } from '../../store/useAppStore';
import {
  syncCancelPairing,
  syncDisable,
  syncEnable,
  syncGetDevices,
  syncGetPairing,
  syncGetStatus,
  syncRevokeDevice,
  syncStartPairing,
  type SyncDevice,
  type SyncPairing,
  type SyncStatus,
} from '../../lib/desktop';
import { useT } from '../../lib/i18n';
import { Smartphone, Trash2 } from 'lucide-react';

const PAIRING_POLL_MS = 2000;

export function MobileSyncSection() {
  const t = useT();
  const { showError, showSuccess } = useAppStore();
  const [status, setStatus] = useState<SyncStatus>({
    enabled: false,
    port: null,
    host: null,
    certFingerprint: null,
  });
  const [devices, setDevices] = useState<SyncDevice[]>([]);
  const [pairing, setPairing] = useState<SyncPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshDevices = async () => {
    try {
      setDevices(await syncGetDevices());
    } catch (error) {
      showError(error);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refreshStatus = async () => {
    try {
      const next = await syncGetStatus();
      setStatus(next);
      if (next.enabled) await refreshDevices();
    } catch (error) {
      showError(error);
    }
  };

  useEffect(() => {
    void refreshStatus();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (status.enabled) {
        await syncDisable();
        setPairing(null);
        stopPolling();
        setDevices([]);
        setStatus({ enabled: false, port: null, host: null, certFingerprint: null });
      } else {
        const next = await syncEnable();
        setStatus(next);
        await refreshDevices();
      }
    } catch (error) {
      showError(error);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const handleStartPairing = async () => {
    setBusy(true);
    try {
      stopPolling();
      const session = await syncStartPairing();
      setPairing(session);
      pollRef.current = setInterval(async () => {
        try {
          const current = await syncGetPairing();
          if (!current) {
            // Pairing consumed, expired, or cancelled — refresh devices + stop polling.
            stopPolling();
            setPairing(null);
            await refreshDevices();
            showSuccess('settings.mobileSync.pairingDone');
            return;
          }
          setPairing(current);
        } catch (error) {
          stopPolling();
          setPairing(null);
          showError(error);
        }
      }, PAIRING_POLL_MS);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelPairing = async () => {
    setBusy(true);
    try {
      await syncCancelPairing();
      stopPolling();
      setPairing(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    try {
      await syncRevokeDevice(deviceId);
      await refreshDevices();
      showSuccess('settings.mobileSync.deviceRevoked');
    } catch (error) {
      showError(error);
    }
  };

  const enabled = status.enabled;

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.mobileSync.title')}</h2>
        <p>{t('settings.mobileSync.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.mobileSync.serverGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.mobileSync.enableRow')}</div>
            <p>{t('settings.mobileSync.enableRowDescription')}</p>
          </div>
          <button onClick={() => void handleToggle()} className="on-button-secondary gap-2" disabled={busy}>
            <Smartphone className="h-4 w-4" strokeWidth={1.9} />
            {enabled ? t('settings.mobileSync.disable') : t('settings.mobileSync.enable')}
          </button>
        </div>

        {enabled ? (
          <div className="on-settings-status">
            {t('settings.mobileSync.reachable', {
              host: status.host ?? '',
              port: String(status.port ?? ''),
            })}
          </div>
        ) : null}

        <p className="on-settings-note">{t('settings.mobileSync.privacyNote')}</p>
      </section>

      {enabled ? (
        <section className="on-settings-group">
          <h3>{t('settings.mobileSync.pairingGroup')}</h3>
          <div className="on-settings-row">
            <div className="on-settings-row-copy">
              <div>{t('settings.mobileSync.pairRow')}</div>
              <p>{t('settings.mobileSync.pairRowDescription')}</p>
            </div>
            <button
              onClick={() => void handleStartPairing()}
              className="on-button-secondary gap-2"
              disabled={busy || !!pairing}
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.9} />
              {t('settings.mobileSync.startPairing')}
            </button>
          </div>

          {pairing ? (
            <div className="on-settings-pairing">
              <div className="on-settings-pairing-qr">
                <QRCodeCanvas value={pairing.qrPayload} size={160} level="M" />
              </div>
              <div className="on-settings-pairing-copy">
                <div>{t('settings.mobileSync.pinLabel', { pin: pairing.pin })}</div>
                <p>{t('settings.mobileSync.pinDescription')}</p>
                <button
                  type="button"
                  className="on-button-secondary gap-2"
                  onClick={() => void handleCancelPairing()}
                  disabled={busy}
                >
                  {t('settings.mobileSync.cancelPairing')}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {enabled ? (
        <section className="on-settings-group">
          <h3>{t('settings.mobileSync.devicesGroup')}</h3>
          {devices.length === 0 ? (
            <div className="on-settings-status">{t('settings.mobileSync.noDevices')}</div>
          ) : (
            <ul className="on-settings-device-list">
              {devices.map((device) => (
                <li key={device.device_id} className="on-settings-row">
                  <div className="on-settings-row-copy">
                    <div>{device.name}</div>
                    <p>
                      {t('settings.mobileSync.deviceMeta', {
                        platform: device.platform,
                        pairedAt: device.paired_at,
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="on-button-secondary gap-2"
                    onClick={() => void handleRevoke(device.device_id)}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                    {t('settings.mobileSync.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}