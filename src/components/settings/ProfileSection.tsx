import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { openDialog } from '../../lib/desktop';
import { useT } from '../../lib/i18n';
import { Trash2, Upload } from 'lucide-react';

export function ProfileSection() {
  const t = useT();
  const profile = useAppStore((state) => state.profile);
  const updateProfileAction = useAppStore((state) => state.updateProfileAction);
  const importProfileAvatarAction = useAppStore((state) => state.importProfileAvatarAction);

  const [name, setName] = useState(profile?.name ?? '');
  const [workspaceName, setWorkspaceName] = useState(profile?.workspaceName ?? '');

  useEffect(() => {
    setName(profile?.name ?? '');
  }, [profile?.name]);

  useEffect(() => {
    setWorkspaceName(profile?.workspaceName ?? '');
  }, [profile?.workspaceName]);

  const commitName = () => {
    const nextName = name.trim();
    setName(nextName);
    if (nextName === (profile?.name ?? '')) return;
    void updateProfileAction({ name: nextName });
  };

  const commitWorkspaceName = () => {
    const nextWorkspaceName = workspaceName.trim();
    setWorkspaceName(nextWorkspaceName);
    if (nextWorkspaceName === (profile?.workspaceName ?? '')) return;
    void updateProfileAction({ workspaceName: nextWorkspaceName });
  };

  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const handleUploadAvatar = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: t('settings.profile.imagesFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });

    if (typeof path !== 'string') return;
    await importProfileAvatarAction(path);
  };

  return (
    <div className="on-settings-content">
      <div className="on-settings-content-title">
        <h2>{t('settings.profile.title')}</h2>
        <p>{t('settings.profile.description')}</p>
      </div>

      <section className="on-settings-group">
        <h3>{t('settings.profile.group')}</h3>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.profile.name')}</div>
            <p>{t('settings.profile.nameDescription')}</p>
          </div>
          <input
            type="text"
            className="on-input on-settings-select"
            aria-label={t('settings.profile.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.profile.workspaceName')}</div>
            <p>{t('settings.profile.workspaceNameDescription')}</p>
          </div>
          <input
            type="text"
            className="on-input on-settings-select"
            aria-label={t('settings.profile.workspaceName')}
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            onBlur={commitWorkspaceName}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="on-settings-row">
          <div className="on-settings-row-copy">
            <div>{t('settings.profile.avatar')}</div>
            <p>{t('settings.profile.avatarDescription')}</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => void handleUploadAvatar()} className="on-button-secondary gap-2">
              <Upload className="h-4 w-4" strokeWidth={1.9} />
              {t('settings.profile.upload')}
            </button>
            {profile?.avatarPath && (
              <button
                onClick={() => void updateProfileAction({ avatarPath: null })}
                className="on-button-secondary gap-2"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                {t('settings.profile.remove')}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
