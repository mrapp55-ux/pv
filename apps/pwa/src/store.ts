import { create } from 'zustand';
import type { SidecarEntry, SidecarGroup } from './types';

export type AppStep = 'google' | 'password' | 'unlocking' | 'unlocked';

interface PwaStore {
  step: AppStep;
  entries: SidecarEntry[];
  groups: SidecarGroup[];
  selectedGroupId: string | null;
  setStep: (s: AppStep) => void;
  setVault: (entries: SidecarEntry[], groups: SidecarGroup[]) => void;
  setSelectedGroupId: (id: string | null) => void;
  lock: () => void;
}

export const usePwaStore = create<PwaStore>((set) => ({
  step: 'google',
  entries: [],
  groups: [],
  selectedGroupId: null,
  setStep: (step) => set({ step }),
  setVault: (entries, groups) => set({ entries, groups }),
  setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
  lock: () => set({ step: 'google', entries: [], groups: [], selectedGroupId: null }),
}));
