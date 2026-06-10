import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../lib/i18n';
import type { EditorFont, EditorFontSize } from '../../lib/preferences';

// Mirror the editor typography font stacks declared in src/index.css
// (.on-editor-font-*) so each option previews its typeface live.
const FONT_PREVIEW_STACKS: Record<EditorFont, string> = {
  sans: 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: '"Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export function AppearanceSection() {
  const t = useT();
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const editorFont = useAppStore((state) => state.editorFont);
  const setEditorFont = useAppStore((state) => state.setEditorFont);
  const editorFontSize = useAppStore((state) => state.editorFontSize);
  const setEditorFontSize = useAppStore((state) => state.setEditorFontSize);

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.appearance.title')}</h2>
        <p>{t('settings.appearance.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.appearance.themeGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.appearance.theme')}</div>
            <p>{t('settings.appearance.themeDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.appearance.theme')}
            value={theme}
            onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
          >
            <option value="system">{t('settings.appearance.themeSystem')}</option>
            <option value="light">{t('settings.appearance.themeLight')}</option>
            <option value="dark">{t('settings.appearance.themeDark')}</option>
          </select>
        </div>
      </section>

      <section className="on-settings-group">
        <h3>{t('settings.appearance.typographyGroup')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.appearance.font')}</div>
            <p>{t('settings.appearance.fontDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.appearance.font')}
            value={editorFont}
            onChange={(event) => setEditorFont(event.target.value as EditorFont)}
          >
            <option value="sans" style={{ fontFamily: FONT_PREVIEW_STACKS.sans }}>
              {t('settings.appearance.fontSans')}
            </option>
            <option value="serif" style={{ fontFamily: FONT_PREVIEW_STACKS.serif }}>
              {t('settings.appearance.fontSerif')}
            </option>
            <option value="mono" style={{ fontFamily: FONT_PREVIEW_STACKS.mono }}>
              {t('settings.appearance.fontMono')}
            </option>
          </select>
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.appearance.fontSize')}</div>
            <p>{t('settings.appearance.fontSizeDescription')}</p>
          </div>
          <select
            className="on-settings-select"
            aria-label={t('settings.appearance.fontSize')}
            value={editorFontSize}
            onChange={(event) => setEditorFontSize(event.target.value as EditorFontSize)}
          >
            <option value="small">{t('settings.appearance.fontSizeSmall')}</option>
            <option value="default">{t('settings.appearance.fontSizeDefault')}</option>
            <option value="large">{t('settings.appearance.fontSizeLarge')}</option>
          </select>
        </div>
      </section>
    </div>
  );
}
