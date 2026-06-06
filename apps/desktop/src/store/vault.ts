import { create } from 'zustand';
import type { EntryListItem, Group } from '../services/tauri-bridge';

export type AuthState = 'loading' | 'setup' | 'locked' | 'unlocked';

interface VaultStore {
  authState: AuthState;
  entries: EntryListItem[];
  groups: Group[];
  selectedId: string | null;
  selectedGroupId: string | null; // null = All Groups
  setAuthState: (s: AuthState) => void;
  setEntries: (entries: EntryListItem[]) => void;
  setGroups: (groups: Group[]) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  reset: () => void;
}

export const useVaultStore = create<VaultStore>((set) => ({
  authState: 'loading',
  entries: [],
  groups: [],
  selectedId: null,
  selectedGroupId: null,
  setAuthState: (authState) => set({ authState }),
  setEntries: (entries) => set({ entries }),
  setGroups: (groups) => set({ groups }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
  reset: () => set({ authState: 'locked', entries: [], groups: [], selectedId: null, selectedGroupId: null }),
}));
