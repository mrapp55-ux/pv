/**
 * Global vault state via Zustand.
 *
 * Auth states:
 *   'loading'    — checking keychain/metadata on app start
 *   'setup'      — no vault exists yet, show first-time setup
 *   'locked'     — vault exists but key is not in memory
 *   'unlocked'   — vault is open, entries accessible
 */

import { create } from 'zustand';
import type { VaultEntry } from '@vault/shared-types';

export type AuthState = 'loading' | 'setup' | 'locked' | 'unlocked';

interface VaultState {
  authState: AuthState;
  entries: Omit<VaultEntry, 'password' | 'notes'>[];
  deviceId: string | null;

  setAuthState: (state: AuthState) => void;
  setEntries: (entries: Omit<VaultEntry, 'password' | 'notes'>[]) => void;
  setDeviceId: (id: string) => void;
  reset: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  authState: 'loading',
  entries: [],
  deviceId: null,

  setAuthState: (authState) => set({ authState }),
  setEntries: (entries) => set({ entries }),
  setDeviceId: (deviceId) => set({ deviceId }),
  reset: () => set({ authState: 'locked', entries: [] }),
}));
