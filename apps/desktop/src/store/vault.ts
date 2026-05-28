import { create } from 'zustand';
import type { EntryListItem } from '../services/tauri-bridge';

export type AuthState = 'loading' | 'setup' | 'locked' | 'unlocked';

interface VaultStore {
  authState: AuthState;
  entries: EntryListItem[];
  selectedId: string | null;
  setAuthState: (s: AuthState) => void;
  setEntries: (entries: EntryListItem[]) => void;
  setSelectedId: (id: string | null) => void;
  reset: () => void;
}

export const useVaultStore = create<VaultStore>((set) => ({
  authState: 'loading',
  entries: [],
  selectedId: null,
  setAuthState: (authState) => set({ authState }),
  setEntries: (entries) => set({ entries }),
  setSelectedId: (selectedId) => set({ selectedId }),
  reset: () => set({ authState: 'locked', entries: [], selectedId: null }),
}));
