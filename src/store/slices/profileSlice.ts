import type { StateCreator } from 'zustand';
import {
  WorkspaceProfile,
  getWorkspaceProfile,
  updateWorkspaceProfile,
  importProfileAvatarFromDialog,
} from '../../lib/profile';
import type { AppState } from '../useAppStore';

export interface ProfileSlice {
  profile: WorkspaceProfile | null;
  fetchProfile: () => Promise<void>;
  updateProfileAction: (patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null }) => Promise<void>;
  importProfileAvatarAction: () => Promise<void>;
}

export const createProfileSlice: StateCreator<AppState, [], [], ProfileSlice> = (set, get) => ({
  profile: null,

  fetchProfile: async () => {
    try {
      set({ profile: await getWorkspaceProfile() });
    } catch (error) {
      get().showError(error);
    }
  },

  updateProfileAction: async (patch) => {
    const previousProfile = get().profile;
    if (previousProfile) {
      set({ profile: { ...previousProfile, ...patch } as WorkspaceProfile });
    }
    try {
      set({ profile: await updateWorkspaceProfile(patch) });
    } catch (error) {
      set({ profile: previousProfile });
      get().showError(error);
    }
  },

  importProfileAvatarAction: async () => {
    try {
      const avatarPath = await importProfileAvatarFromDialog();
      if (!avatarPath) return;
      const current = get().profile;
      if (current) set({ profile: { ...current, avatarPath } });
    } catch (error) {
      get().showError(error);
    }
  },
});
