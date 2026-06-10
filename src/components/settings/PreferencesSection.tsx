import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../lib/i18n';
import type { LocalePreference, PageWidth, TitleEnterBehavior } from '../../lib/preferences';

export function PreferencesSection() {
  const t = useT();
  const localePreference = useAppStore((state) => state.localePreference);
  const setLocalePreference = useAppStore((state) => state.setLocalePreference);
  const titleEnterBehavior = useAppStore((state) => state.titleEnterBehavior);
  const setTitleEnterBehavior = useAppStore((state) => state.setTitleEnterBehavior);
  const pageWidth = useAppStore((state) => state.pageWidth);
  const setPageWidth = useAppStore((state) => state.setPageWidth);

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.preferences.title')}</h2>
        <p>{t('settings.preferences.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.preferences.languageGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.preferences.language')}</div>
            <p>{t('settings.preferences.languageDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.preferences.language')}
            value={localePreference}
            onChange={(event) => setLocalePreference(event.target.value as LocalePreference)}
          >
            <option value="system">{t('settings.preferences.languageSystem')}</option>
            <option value="en">{t('settings.preferences.languageEnglish')}</option>
            <option value="it">{t('settings.preferences.languageItalian')}</option>
          </select>
        </div>
      </section>

      <section className="on-settings-group">
        <h3>{t('settings.preferences.inputGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.preferences.titleEnter')}</div>
            <p>{t('settings.preferences.titleEnterDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.preferences.titleEnter')}
            value={titleEnterBehavior}
            onChange={(event) => setTitleEnterBehavior(event.target.value as TitleEnterBehavior)}
          >
            <option value="body">{t('settings.preferences.titleEnterBody')}</option>
            <option value="newline">{t('settings.preferences.titleEnterNewline')}</option>
          </select>
        </div>
      </section>

      <section className="on-settings-group">
        <h3>{t('settings.preferences.layoutGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.preferences.pageWidth')}</div>
            <p>{t('settings.preferences.pageWidthDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.preferences.pageWidth')}
            value={pageWidth}
            onChange={(event) => setPageWidth(event.target.value as PageWidth)}
          >
            <option value="centered">{t('settings.preferences.pageWidthCentered')}</option>
            <option value="full">{t('settings.preferences.pageWidthFull')}</option>
          </select>
        </div>
      </section>
    </div>
  );
}
