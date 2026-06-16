import { create } from 'zustand';
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
import { createStudioSlice, type StudioSlice } from './slices/studioSlice';
import { createPagesSlice, type PagesSlice } from './slices/pagesSlice';

export interface AppState extends SharedSlice, ProfileSlice, StudioSlice, PagesSlice {}

export const useAppStore = create<AppState>()((set, get, ...a) => ({
  ...createSharedSlice(set, get, ...a),
  ...createProfileSlice(set, get, ...a),
  ...createStudioSlice(set, get, ...a),
  ...createPagesSlice(set, get, ...a),
}));
