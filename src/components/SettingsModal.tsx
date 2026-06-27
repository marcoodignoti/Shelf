import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import type { SettingsSection } from '../lib/settings';
import { TranslationKey, useT } from '../lib/i18n';
import { ProfileSection } from './settings/ProfileSection';
import { PreferencesSection } from './settings/PreferencesSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { ShortcutsSection } from './settings/ShortcutsSection';
import { UpdatesSection } from './settings/UpdatesSection';
import { DataSection } from './settings/DataSection';
import { AboutSection } from './settings/AboutSection';
import { MobileSyncSection } from './settings/MobileSyncSection';
import {
  ArrowLeft,
  Download,
  Info,
  Keyboard,
  LucideIcon,
  Palette,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Smartphone,
  UserCircle,
  X,
} from 'lucide-react';

interface SettingsNavEntry {
  section: SettingsSection;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

interface SettingsNavGroup {
  labelKey: TranslationKey;
  entries: SettingsNavEntry[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    labelKey: 'settings.nav.personal',
    entries: [
      { section: 'preferences', labelKey: 'settings.nav.preferences', icon: SlidersHorizontal },
      { section: 'profile', labelKey: 'settings.nav.profile', icon: UserCircle },
      { section: 'appearance', labelKey: 'settings.nav.appearance', icon: Palette },
      { section: 'shortcuts', labelKey: 'settings.nav.shortcuts', icon: Keyboard },
    ],
  },
  {
    labelKey: 'settings.nav.workspace',
    entries: [
      { section: 'updates', labelKey: 'settings.nav.updates', icon: RefreshCw },
      { section: 'data', labelKey: 'settings.nav.data', icon: Download },
      { section: 'mobile-sync', labelKey: 'settings.nav.mobileSync', icon: Smartphone },
      { section: 'about', labelKey: 'settings.nav.about', icon: Info },
    ],
  },
];

const SECTION_COMPONENTS: Record<SettingsSection, ComponentType> = {
  profile: ProfileSection,
  preferences: PreferencesSection,
  appearance: AppearanceSection,
  shortcuts: ShortcutsSection,
  updates: UpdatesSection,
  data: DataSection,
  'mobile-sync': MobileSyncSection,
  about: AboutSection,
};

export function SettingsModal({
  isOpen,
  initialSection = 'profile',
  onClose,
  embedded = false,
}: {
  isOpen: boolean;
  initialSection?: SettingsSection;
  onClose: () => void;
  embedded?: boolean;
}) {
  const t = useT();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    setActiveSection(initialSection);
    setQuery('');
    if (!embedded) closeOpenOverlays();
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
  }, [embedded, initialSection, isOpen, onClose]);

  const searchQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!searchQuery) return NAV_GROUPS;
    return NAV_GROUPS
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => t(entry.labelKey).toLowerCase().includes(searchQuery)),
      }))
      .filter((group) => group.entries.length > 0);
  }, [searchQuery, t]);
  const ActiveSection = SECTION_COMPONENTS[activeSection];
  const activeEntry = NAV_GROUPS.flatMap((group) => group.entries).find((entry) => entry.section === activeSection);

  if (!isOpen) return null;

  const settingsPanel = (
    <div className="on-modal-panel on-settings-panel" onMouseDown={(event) => event.stopPropagation()}>
      <aside className="on-settings-sidebar">
        {!embedded ? (
          <div className="on-settings-window-controls" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}

          <button type="button" className="on-settings-back" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
            <span>{t('settings.backToApp')}</span>
          </button>

          <label className="on-settings-search">
            <Search className="h-4 w-4" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.searchPlaceholder')}
              aria-label={t('settings.searchPlaceholder')}
            />
          </label>

          <div className="on-settings-sidebar-scroll">
            <nav className="on-settings-nav" aria-label={t('settings.nav.ariaLabel')}>
              {visibleGroups.map((group) => (
                <div key={group.labelKey} className="on-settings-nav-group">
                  <div className="on-settings-nav-label">{t(group.labelKey)}</div>
                  {group.entries.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.section}
                        type="button"
                        className={`on-settings-nav-item ${activeSection === entry.section ? 'on-settings-nav-item-active' : ''}`}
                        onClick={() => setActiveSection(entry.section)}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.9} />
                        <span>{t(entry.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
      </aside>

      <main className="on-settings-main">
        <div className="on-settings-header">
          <div className="on-settings-current-title">{activeEntry ? t(activeEntry.labelKey) : t('sidebar.settings')}</div>
          {!embedded ? (
            <button onClick={onClose} className="on-settings-close" aria-label={t('settings.close')}>
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <div className="on-settings-body">
          <ActiveSection />
        </div>
      </main>
    </div>
  );

  if (embedded) {
    return <div className="on-settings-window">{settingsPanel}</div>;
  }

  return createPortal(
    <div className="on-modal-overlay on-settings-overlay items-center justify-center" onMouseDown={onClose}>
      {settingsPanel}
    </div>,
    document.body
  );
}
