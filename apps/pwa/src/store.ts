import { create } from 'zustand';
import type { SidecarEntry, SidecarGroup } from './types';
import { clearResumeSession } from './services/resumeSession';

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
  lock: () => {
    clearResumeSession();
    const hasCached = !!(localStorage.getItem('pv_salt') && localStorage.getItem('pv_enc'));
    set({ step: hasCached ? 'password' : 'google', entries: [], groups: [], selectedGroupId: null });
  },
}));
