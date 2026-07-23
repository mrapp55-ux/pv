const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_NAME = 'PV';

let _accessToken: string | null = null;

export function setAccessToken(token: string): void {
  _accessToken = token;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

function token(): string {
  if (!_accessToken) throw new Error('Not signed in to Google');
  return _accessToken;
}

async function driveGet(path: string): Promise<Response> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  return res;
}

async function findFolderId(): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await driveGet(`/files?q=${q}&fields=files(id)&spaces=drive`);
  const data = await res.json() as { files: Array<{ id: string }> };
  if (!data.files.length) {
    throw new Error('PV folder not found on Google Drive. Open the desktop app and create a vault first.');
  }
  return data.files[0].id;
}

async function findFileId(folderId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await driveGet(`/files?q=${q}&fields=files(id)&spaces=drive`);
  const data = await res.json() as { files: Array<{ id: string }> };
  if (!data.files.length) {
    throw new Error(`${name} not found. Add or edit an entry in the desktop app to generate it.`);
  }
  return data.files[0].id;
}

async function downloadText(fileId: string): Promise<string> {
  const res = await driveGet(`/files/${fileId}?alt=media`);
  return res.text();
}

/** Download vault.settings.json from the PV folder. Returns null if missing or unreadable. */
export async function downloadSettings(): Promise<{ auto_lock_seconds?: number } | null> {
  try {
    const folderId = await findFolderId();
    const q = encodeURIComponent(
      `name='vault.settings.json' and '${folderId}' in parents and trashed=false`,
    );
    const res = await driveGet(`/files?q=${q}&fields=files(id)&spaces=drive`);
    const data = await res.json() as { files: Array<{ id: string }> };
    if (!data.files.length) return null;
    const text = await downloadText(data.files[0].id);
    return JSON.parse(text) as { auto_lock_seconds?: number };
  } catch {
    return null;
  }
}

/** Download vault.salt and vault.enc from the PV folder in My Drive. */
export async function downloadVaultFiles(): Promise<{ saltB64: string; encryptedB64: string }> {
  const folderId = await findFolderId();
  const [saltId, encId] = await Promise.all([
    findFileId(folderId, 'vault.salt'),
    findFileId(folderId, 'vault.enc'),
  ]);
  const [saltB64, encryptedB64] = await Promise.all([
    downloadText(saltId),
    downloadText(encId),
  ]);
  return { saltB64: saltB64.trim(), encryptedB64: encryptedB64.trim() };
}
