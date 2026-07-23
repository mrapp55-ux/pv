/**
 * Google Drive sync service for mobile.
 *
 * Strategy:
 *   - Vault files (vault.db + vault.salt) live in "My Drive/PV/" on Google Drive.
 *   - Desktop computers use the native Google Drive client — no API calls needed there.
 *   - Mobile downloads before unlock (if remote is newer), uploads after every write.
 *   - The vault file is always encrypted; Drive stores only ciphertext (zero-knowledge).
 *
 * Setup required:
 *   - Create a Google Cloud project, enable Drive API, create OAuth 2.0 credentials.
 *   - Fill in GOOGLE_WEB_CLIENT_ID and GOOGLE_IOS_CLIENT_ID in src/config/googleAuth.ts
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'PV';
const DB_FILE_NAME = 'vault.db';
const SALT_FILE_NAME = 'vault.salt';
const SETTINGS_FILE_NAME = 'vault.settings.json';

// SecureStore key for the Drive file ID (cached to avoid re-searching)
const STORE_DB_FILE_ID = 'drive_db_file_id';
const STORE_SALT_FILE_ID = 'drive_salt_file_id';
const STORE_SETTINGS_FILE_ID = 'drive_settings_file_id';
const STORE_FOLDER_ID = 'drive_folder_id';
// Last known remote modification time (epoch ms string)
const STORE_LAST_SYNC_MODIFIED = 'drive_last_sync_modified';
// Cached auto-lock timeout in ms (-1 = never synced, 0 = disabled)
const STORE_AUTO_LOCK_MS = 'auto_lock_ms';

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if the user is currently signed in to Google. */
export function isGoogleSignedIn(): boolean {
  return GoogleSignin.isSignedIn();
}

/** Sign in to Google and request Drive file scope. */
export async function signInWithGoogle(): Promise<void> {
  await GoogleSignin.signIn();
}

/** Sign out of Google (sync will stop working until sign-in again). */
export async function signOutOfGoogle(): Promise<void> {
  await GoogleSignin.signOut();
  await SecureStore.deleteItemAsync(STORE_DB_FILE_ID).catch(() => {});
  await SecureStore.deleteItemAsync(STORE_SALT_FILE_ID).catch(() => {});
  await SecureStore.deleteItemAsync(STORE_SETTINGS_FILE_ID).catch(() => {});
  await SecureStore.deleteItemAsync(STORE_FOLDER_ID).catch(() => {});
  await SecureStore.deleteItemAsync(STORE_LAST_SYNC_MODIFIED).catch(() => {});
}

/**
 * Returns the auto-lock timeout in milliseconds synced from desktop settings.
 * 0 = disabled. Falls back to 60 000 ms if settings have never been synced.
 */
export async function getAutoLockMs(): Promise<number> {
  const cached = await SecureStore.getItemAsync(STORE_AUTO_LOCK_MS);
  if (cached === null) return 60_000;
  return parseInt(cached, 10);
}

/**
 * Called on app open after unlock.
 * If the Drive vault is newer than the local one, downloads it and returns true
 * (caller should close + reopen the DB).
 * Returns false if already up-to-date, not signed in, or offline.
 * Caps the entire sync at 5 s so a network timeout never stalls unlock.
 */
export async function syncOnOpen(): Promise<boolean> {
  if (!isGoogleSignedIn()) return false;
  try {
    const token = await Promise.race([
      getAccessToken(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sync timeout')), 5_000),
      ),
    ]);
    const dbFileId = await getOrCacheFileId(token, DB_FILE_NAME, STORE_DB_FILE_ID);
    if (!dbFileId) return false; // no vault on Drive yet

    const remoteMeta = await getDriveFileMeta(token, dbFileId);
    const remoteModified = new Date(remoteMeta.modifiedTime).getTime();
    const lastSyncModified = parseInt(
      (await SecureStore.getItemAsync(STORE_LAST_SYNC_MODIFIED)) ?? '0',
      10,
    );

    if (remoteModified <= lastSyncModified) return false; // already in sync

    // Download newer vault.db
    await downloadFile(token, dbFileId, localDbPath());

    // Also download vault.salt (may have changed if vault was re-created)
    const saltFileId = await getOrCacheFileId(token, SALT_FILE_NAME, STORE_SALT_FILE_ID);
    if (saltFileId) {
      const saltContent = await downloadTextFile(token, saltFileId);
      await SecureStore.setItemAsync('vault_salt', saltContent.trim());
    }

    await SecureStore.setItemAsync(STORE_LAST_SYNC_MODIFIED, String(remoteModified));
    void syncSettings(token);
    return true;
  } catch (e) {
    console.warn('[sync] syncOnOpen failed (continuing offline):', e);
    return false;
  }
}

/**
 * Called after any write operation (create/update/delete entry).
 * Uploads vault.db (and vault.salt if not yet on Drive) to Google Drive.
 * Runs in the background — does not block the UI.
 */
export function syncAfterWrite(): void {
  void _doUpload().catch(e => console.warn('[sync] upload failed:', e));
}

/**
 * Check if a vault already exists on Google Drive.
 * Used during setup to offer "join existing vault" flow.
 */
export async function driveVaultExists(): Promise<boolean> {
  if (!isGoogleSignedIn()) return false;
  try {
    const token = await getAccessToken();
    const fileId = await getOrCacheFileId(token, DB_FILE_NAME, STORE_DB_FILE_ID);
    return !!fileId;
  } catch {
    return false;
  }
}

/**
 * Download the vault from Drive to local storage.
 * Stores vault.salt in SecureStore and vault.db at the local DB path.
 * Call this when joining an existing vault from a new device.
 */
export async function downloadVaultFromDrive(): Promise<void> {
  const token = await getAccessToken();

  const dbFileId = await getOrCacheFileId(token, DB_FILE_NAME, STORE_DB_FILE_ID);
  if (!dbFileId) throw new Error('No vault found on Google Drive.');

  await downloadFile(token, dbFileId, localDbPath());

  const saltFileId = await getOrCacheFileId(token, SALT_FILE_NAME, STORE_SALT_FILE_ID);
  if (saltFileId) {
    const salt = await downloadTextFile(token, saltFileId);
    await SecureStore.setItemAsync('vault_salt', salt.trim());
  }

  const remoteMeta = await getDriveFileMeta(token, dbFileId);
  await SecureStore.setItemAsync(
    STORE_LAST_SYNC_MODIFIED,
    String(new Date(remoteMeta.modifiedTime).getTime()),
  );
  void syncSettings(token);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function localDbPath(): string {
  return (FileSystem.documentDirectory ?? '') + 'vault.db';
}

async function getAccessToken(): Promise<string> {
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

async function getOrCreateFolder(token: string): Promise<string> {
  const cached = await SecureStore.getItemAsync(STORE_FOLDER_ID);
  if (cached) return cached;

  // Search for existing PV folder
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const listRes = await driveGet(token, `/files?q=${q}&fields=files(id)`);
  if (listRes.files?.length) {
    const id = listRes.files[0].id as string;
    await SecureStore.setItemAsync(STORE_FOLDER_ID, id);
    return id;
  }

  // Create the folder
  const createRes = await drivePost(token, '/files', {
    name: FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder',
  });
  const id = createRes.id as string;
  await SecureStore.setItemAsync(STORE_FOLDER_ID, id);
  return id;
}

async function getOrCacheFileId(
  token: string,
  fileName: string,
  cacheKey: string,
): Promise<string | null> {
  const cached = await SecureStore.getItemAsync(cacheKey);
  if (cached) return cached;

  const folderId = await getOrCreateFolder(token);
  const q = encodeURIComponent(
    `name='${fileName}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await driveGet(token, `/files?q=${q}&fields=files(id)`);
  if (res.files?.length) {
    const id = res.files[0].id as string;
    await SecureStore.setItemAsync(cacheKey, id);
    return id;
  }
  return null;
}

async function getDriveFileMeta(token: string, fileId: string): Promise<{ modifiedTime: string }> {
  return driveGet(token, `/files/${fileId}?fields=modifiedTime`);
}

async function downloadFile(token: string, fileId: string, destPath: string): Promise<void> {
  // Use expo-file-system download for binary files
  const result = await FileSystem.downloadAsync(
    `${DRIVE_API}/files/${fileId}?alt=media`,
    destPath,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (result.status !== 200) {
    throw new Error(`Drive download failed: HTTP ${result.status}`);
  }
}

async function downloadTextFile(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive text download failed: HTTP ${res.status}`);
  return res.text();
}

async function _doUpload(): Promise<void> {
  if (!isGoogleSignedIn()) return;
  const token = await getAccessToken();
  const folderId = await getOrCreateFolder(token);

  // Upload vault.db
  const dbPath = localDbPath();
  const dbInfo = await FileSystem.getInfoAsync(dbPath);
  if (!dbInfo.exists) return;

  const dbFileId = await getOrCacheFileId(token, DB_FILE_NAME, STORE_DB_FILE_ID);
  const dbBase64 = await FileSystem.readAsStringAsync(dbPath, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (dbFileId) {
    await updateDriveFile(token, dbFileId, DB_FILE_NAME, dbBase64, 'application/octet-stream');
  } else {
    const newId = await createDriveFile(token, folderId, DB_FILE_NAME, dbBase64, 'application/octet-stream');
    await SecureStore.setItemAsync(STORE_DB_FILE_ID, newId);
  }

  // Upload vault.salt
  const saltB64 = await SecureStore.getItemAsync('vault_salt');
  if (saltB64) {
    const saltBase64 = btoa(saltB64);
    const saltFileId = await getOrCacheFileId(token, SALT_FILE_NAME, STORE_SALT_FILE_ID);
    if (saltFileId) {
      await updateDriveFile(token, saltFileId, SALT_FILE_NAME, saltBase64, 'text/plain');
    } else {
      const newId = await createDriveFile(token, folderId, SALT_FILE_NAME, saltBase64, 'text/plain');
      await SecureStore.setItemAsync(STORE_SALT_FILE_ID, newId);
    }
  }

  // Record the upload time so syncOnOpen knows we're in sync
  const dbMeta = await getDriveFileMeta(token, (await SecureStore.getItemAsync(STORE_DB_FILE_ID))!);
  await SecureStore.setItemAsync(
    STORE_LAST_SYNC_MODIFIED,
    String(new Date(dbMeta.modifiedTime).getTime()),
  );
}

async function createDriveFile(
  token: string,
  folderId: string,
  name: string,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const boundary = 'vault_boundary_1a2b3c';
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Data}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive create failed: HTTP ${res.status}`);
  const json = await res.json() as { id: string };
  return json.id;
}

async function updateDriveFile(
  token: string,
  fileId: string,
  name: string,
  base64Data: string,
  mimeType: string,
): Promise<void> {
  const boundary = 'vault_boundary_1a2b3c';
  const metadata = JSON.stringify({ name });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Data}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive update failed: HTTP ${res.status} for ${name}`);
}

async function syncSettings(token: string): Promise<void> {
  try {
    const fileId = await getOrCacheFileId(token, SETTINGS_FILE_NAME, STORE_SETTINGS_FILE_ID);
    if (!fileId) return;
    const text = await downloadTextFile(token, fileId);
    const parsed = JSON.parse(text) as { auto_lock_seconds?: number };
    if (typeof parsed.auto_lock_seconds === 'number') {
      await SecureStore.setItemAsync(STORE_AUTO_LOCK_MS, String(parsed.auto_lock_seconds * 1000));
    }
  } catch {
    // Non-critical — keep cached value
  }
}

// ─── Drive REST helpers ───────────────────────────────────────────────────────

async function driveGet(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive GET ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function drivePost(
  token: string,
  path: string,
  body: object,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive POST ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}
