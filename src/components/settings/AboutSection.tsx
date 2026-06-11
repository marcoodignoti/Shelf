import { useAppStore } from '../../store/useAppStore';
import { openExternalUrl } from '../../lib/desktop';
import { CURRENT_APP_VERSION } from '../../lib/betaUpdates';
import { useT } from '../../lib/i18n';
import { Copy, ExternalLink } from 'lucide-react';

const REPOSITORY_URL = 'https://github.com/marcoodignoti/OpenNotion';
const LICENSE_URL = 'https://github.com/marcoodignoti/OpenNotion/blob/main/LICENSE';
const DATABASE_PATH = '~/Library/Application Support/org.opennotion.desktop/opennotion.db';

export function AboutSection() {
  const t = useT();
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);

  const handleOpenUrl = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error: unknown) {
      showError(error);
    }
  };

  const handleCopyDatabasePath = async () => {
    try {
      await navigator.clipboard.writeText(DATABASE_PATH);
      showSuccess('settings.about.copied');
    } catch (error: unknown) {
      showError(error);
    }
  };

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.about.title')}</h2>
        <p>{t('settings.about.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.about.group')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.about.version')}</div>
            <p>{t('settings.about.versionDescription')}</p>
          </div>
          <span className="on-settings-pill">{CURRENT_APP_VERSION}</span>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.about.github')}</div>
            <p>{t('settings.about.githubDescription')}</p>
          </div>
          <button onClick={() => void handleOpenUrl(REPOSITORY_URL)} className="on-button-secondary gap-2">
            <ExternalLink className="h-4 w-4" strokeWidth={1.9} />
            {t('settings.about.githubButton')}
          </button>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.about.database')}</div>
            <p>{t('settings.about.databaseDescription')}</p>
            <p><code className="on-settings-kbd">{DATABASE_PATH}</code></p>
          </div>
          <button onClick={() => void handleCopyDatabasePath()} className="on-button-secondary gap-2">
            <Copy className="h-4 w-4" strokeWidth={1.9} />
            {t('settings.about.copy')}
          </button>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.about.license')}</div>
            <p>{t('settings.about.licenseDescription')}</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="on-settings-pill">{t('settings.about.licenseName')}</span>
            <button onClick={() => void handleOpenUrl(LICENSE_URL)} className="on-button-secondary gap-2">
              <ExternalLink className="h-4 w-4" strokeWidth={1.9} />
              {t('settings.about.licenseButton')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
