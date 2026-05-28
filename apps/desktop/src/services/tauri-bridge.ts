/**
 * Typed wrappers around Tauri invoke() calls.
 * All sensitive data (passwords, decrypted entries) flows exclusively through
 * this IPC bridge — never stored in localStorage or sessionStorage.
 */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface SecurityQuestion {
  question: string;
  answer: string;
}

export interface EntryListItem {
  id: string;
  title: string;
  username: string | null;
  url: string | null;
  modified_at: number;
}

export interface EntryDetail {
  id: string;
  title: string;
  username: string | null;
  password: string;
  url: string | null;
  notes: string | null;
  security_questions: SecurityQuestion[] | null;
  created_at: number;
  modified_at: number;
}

export interface EntryInput {
  title: string;
  username: string | null;
  password: string;
  url: string | null;
  notes: string | null;
  security_questions: SecurityQuestion[] | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const isVaultInitialized = () =>
  invoke<boolean>('cmd_is_vault_initialized');

export const isUnlocked = () =>
  invoke<boolean>('cmd_is_unlocked');

export const isBiometricAvailable = () =>
  invoke<boolean>('cmd_is_biometric_available');

export const initializeVault = (password: string, enableBiometric: boolean) =>
  invoke<void>('cmd_initialize_vault', { password, enableBiometric });

export const unlockVault = (password: string) =>
  invoke<void>('cmd_unlock_vault', { password });

export const unlockBiometric = () =>
  invoke<void>('cmd_unlock_biometric');

export const lockVault = () =>
  invoke<void>('cmd_lock');

export const enableBiometric = () =>
  invoke<void>('cmd_enable_biometric');

export const disableBiometric = () =>
  invoke<void>('cmd_disable_biometric');

export const deleteVault = () =>
  invoke<void>('cmd_delete_vault');

// ─── Entries ──────────────────────────────────────────────────────────────────

export const listEntries = () =>
  invoke<EntryListItem[]>('cmd_list_entries');

export const getEntry = (id: string) =>
  invoke<EntryDetail>('cmd_get_entry', { id });

export const createEntry = (entry: EntryInput) =>
  invoke<string>('cmd_create_entry', { entry });

export const updateEntry = (id: string, entry: EntryInput) =>
  invoke<void>('cmd_update_entry', { id, entry });

export const deleteEntry = (id: string) =>
  invoke<void>('cmd_delete_entry', { id });

// ─── Utilities ────────────────────────────────────────────────────────────────

export const generatePassword = (opts?: {
  length?: number;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
}) => invoke<string>('cmd_generate_password', opts ?? {});

// ─── Vault location / sync ────────────────────────────────────────────────────

/** Returns the currently configured vault folder, or null if using default. */
export const getVaultFolder = () =>
  invoke<string | null>('cmd_get_vault_folder');

/** Save vault folder preference (creates the folder if it doesn't exist). */
export const setVaultFolder = (folder: string) =>
  invoke<void>('cmd_set_vault_folder', { folder });

/**
 * Move vault.db + vault.salt to a new folder while the vault is open.
 * The DB is closed, files copied, config updated, DB reopened automatically.
 */
export const relocateVault = (newFolder: string) =>
  invoke<void>('cmd_relocate_vault', { newFolder });

/** Detect the Google Drive "My Drive" root on this machine, or null if not found. */
export const detectGoogleDrive = () =>
  invoke<string | null>('cmd_detect_google_drive');

/**
 * Open a native folder picker dialog.
 * Returns the selected path, or null if cancelled.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const result = await open({ directory: true, title: 'Select Vault Storage Folder' });
  if (typeof result === 'string') return result;
  return null;
}
