import { create } from 'zustand';
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
import { createStudioSlice, type StudioSlice } from './slices/studioSlice';
import { createPagesSlice, type PagesSlice } from './slices/pagesSlice';
import { createSplitSlice, type SplitSlice } from './slices/splitSlice';

export interface AppState extends SharedSlice, ProfileSlice, StudioSlice, PagesSlice, SplitSlice {}

export const useAppStore = create<AppState>()((set, get, ...a) => ({
  ...createSharedSlice(set, get, ...a),
  ...createProfileSlice(set, get, ...a),
  ...createStudioSlice(set, get, ...a),
  ...createPagesSlice(set, get, ...a),
  ...createSplitSlice(set, get, ...a),
}));
