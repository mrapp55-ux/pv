/**
 * Typed wrappers around Tauri invoke() calls.
 * All sensitive data (passwords, decrypted entries) flows exclusively through
 * this IPC bridge — never stored in localStorage or sessionStorage.
 */

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export interface SecurityQuestion {
  question: string;
  answer: string;
}

export interface Group {
  id: string;
  name: string;
  created_at: number;
}

export interface EntryListItem {
  id: string;
  title: string;
  username: string | null;
  url: string | null;
  modified_at: number;
  group_id: string | null;
}

export interface EntryDetail {
  id: string;
  title: string;
  username: string | null;
  password: string;
  url: string | null;
  notes: string | null;
  security_questions: SecurityQuestion[] | null;
  group_id: string | null;
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
  group_id: string | null;
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

// ─── Groups ───────────────────────────────────────────────────────────────────

export const listGroups = () =>
  invoke<Group[]>('cmd_list_groups');

export const createGroup = (name: string) =>
  invoke<string>('cmd_create_group', { name });

export const renameGroup = (id: string, name: string) =>
  invoke<void>('cmd_rename_group', { id, name });

export const deleteGroup = (id: string) =>
  invoke<void>('cmd_delete_group', { id });

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

/** Get auto-lock timeout in seconds (0 = disabled, default 30). */
export const getAutoLockSeconds = () =>
  invoke<number>('cmd_get_auto_lock_seconds');

/** Persist auto-lock timeout in seconds (0 = disabled). */
export const setAutoLockSeconds = (seconds: number) =>
  invoke<void>('cmd_set_auto_lock_seconds', { seconds });

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

/** Open a native Save File dialog. Returns the chosen path, or null if cancelled. */
export async function saveFileDialog(opts: {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const result = await save(opts);
  return typeof result === 'string' ? result : null;
}

/** Write binary data to a file at the given path. */
export const writeFile = (path: string, data: number[]) =>
  invoke<void>('cmd_write_file', { path, data });

/** Copy vault.db + vault.salt to destFolder with a timestamp suffix. Returns the filename stem. */
export const backupVault = (destFolder: string) =>
  invoke<string>('cmd_backup_vault', { destFolder });
