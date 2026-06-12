import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { fileSrc } from '../lib/desktop';
import { TranslationKey, useT } from '../lib/i18n';
import { ProfileSection } from './settings/ProfileSection';
import { PreferencesSection } from './settings/PreferencesSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { ShortcutsSection } from './settings/ShortcutsSection';
import { UpdatesSection } from './settings/UpdatesSection';
import { DataSection } from './settings/DataSection';
import { AboutSection } from './settings/AboutSection';
import {
  Download,
  Info,
  Keyboard,
  LucideIcon,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  UserCircle,
  X,
} from 'lucide-react';

type SettingsSection = 'profile' | 'preferences' | 'appearance' | 'shortcuts' | 'updates' | 'data' | 'about';

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
    labelKey: 'settings.nav.account',
    entries: [
      { section: 'profile', labelKey: 'settings.nav.profile', icon: UserCircle },
    ],
  },
  {
    labelKey: 'settings.nav.workspace',
    entries: [
      { section: 'preferences', labelKey: 'settings.nav.preferences', icon: SlidersHorizontal },
      { section: 'appearance', labelKey: 'settings.nav.appearance', icon: Palette },
      { section: 'shortcuts', labelKey: 'settings.nav.shortcuts', icon: Keyboard },
      { section: 'updates', labelKey: 'settings.nav.updates', icon: RefreshCw },
      { section: 'data', labelKey: 'settings.nav.data', icon: Download },
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
  about: AboutSection,
};

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const t = useT();
  const profile = useAppStore((state) => state.profile);
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

  useEffect(() => {
    if (!isOpen) return;

    closeOpenOverlays();
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, onClose);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cardTitle = profile?.workspaceName || 'Shelf';
  const cardSubtitle = profile?.name || t('settings.card.localWorkspace');
  const avatarInitial = (profile?.name || profile?.workspaceName || 'S').trim().charAt(0).toUpperCase() || 'S';
  const ActiveSection = SECTION_COMPONENTS[activeSection];

  return createPortal(
    <div className="on-modal-overlay on-settings-overlay items-center justify-center" onMouseDown={onClose}>
      <div className="on-modal-panel on-settings-panel" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="on-settings-sidebar">
          <div className="on-settings-account-card">
            {profile?.avatarPath ? (
              <img className="on-settings-avatar on-settings-avatar-img" src={fileSrc(profile.avatarPath)} alt="" />
            ) : (
              <span className="on-settings-avatar">{avatarInitial}</span>
            )}
            <div>
              <h2>{cardTitle}</h2>
              <p>{cardSubtitle}</p>
            </div>
          </div>

          <nav className="on-settings-nav" aria-label={t('settings.nav.ariaLabel')}>
            {NAV_GROUPS.map((group) => (
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
                      {t(entry.labelKey)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="on-settings-main">
          <div className="on-settings-header">
            <button onClick={onClose} className="on-settings-close" aria-label={t('settings.close')}>
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="on-settings-body">
            <ActiveSection />
          </div>
        </main>
      </div>
    </div>,
    document.body
  );
}
