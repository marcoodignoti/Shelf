import { SHORTCUT_GROUPS } from '../../lib/shortcuts';
import { useT } from '../../lib/i18n';

const NON_MAC_KEY_MAP: Record<string, string> = {
  '⌘': 'Ctrl',
  '⌥': 'Alt',
  '⌫': 'Del',
};

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}

export function displayKey(key: string, isMac: boolean): string {
  if (isMac) return key;
  return NON_MAC_KEY_MAP[key] ?? key;
}

export function ShortcutsSection() {
  const t = useT();
  const isMac = isMacPlatform();

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.shortcuts.title')}</h2>
        <p>{t('settings.shortcuts.description')}</p>
      </div>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.titleKey} className="on-settings-group">
          <h3>{t(group.titleKey)}</h3>
          {group.shortcuts.map((shortcut) => (
            <div key={shortcut.labelKey} className="on-settings-row">
              <div className="on-settings-row-copy">
                <div>{t(shortcut.labelKey)}</div>
              </div>
              <span className="flex items-center justify-end gap-1">
                {shortcut.keys.map((key, index) => (
                  <kbd key={`${shortcut.labelKey}-${index}`} className="on-settings-kbd">
                    {displayKey(key, isMac)}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
