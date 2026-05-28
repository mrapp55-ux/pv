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

export interface VaultLocationInfo {
  use_google_drive: boolean;
  resolved_folder: string;
  google_drive_available: boolean;
  google_drive_folder: string | null;
}

/** Full vault location info — use this instead of getVaultFolder. */
export const getVaultLocation = () =>
  invoke<VaultLocationInfo>('cmd_get_vault_location');

/** Switch to Google Drive auto-detect mode (true) or custom/local (false). */
export const setUseGoogleDrive = (enabled: boolean) =>
  invoke<void>('cmd_set_use_google_drive', { enabled });

/** Save a custom vault folder path and switch to local mode. */
export const setVaultFolder = (folder: string) =>
  invoke<void>('cmd_set_vault_folder', { folder });

/** Move vault.db + vault.salt to a new folder while the vault is open. */
export const relocateVault = (newFolder: string) =>
  invoke<void>('cmd_relocate_vault', { newFolder });

/** Get auto-lock timeout in minutes (0 = disabled, default 5). */
export const getAutoLockMinutes = () =>
  invoke<number>('cmd_get_auto_lock_minutes');

/** Persist auto-lock timeout in minutes (0 = disabled). */
export const setAutoLockMinutes = (minutes: number) =>
  invoke<void>('cmd_set_auto_lock_minutes', { minutes });

/** Change master password — verifies old, re-encrypts all fields, rekeys DB. */
export const changeMasterPassword = (oldPassword: string, newPassword: string) =>
  invoke<void>('cmd_change_master_password', { oldPassword, newPassword });

/**
 * Open a native folder picker dialog.
 * Returns the selected path, or null if cancelled.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const result = await open({ directory: true, title: 'Select Vault Storage Folder' });
  if (typeof result === 'string') return result;
  return null;
}
