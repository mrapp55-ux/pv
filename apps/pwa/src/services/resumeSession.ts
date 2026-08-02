// Grace-period resume session.
//
// iOS aggressively kills the PWA's process when the screen locks or the app is
// backgrounded, wiping all in-memory state. Without this, every cold restart forces a
// full re-login regardless of how little time has actually passed — even a few seconds
// after a screen lock — because there's nothing left in memory to resume from.
//
// The wrapping key is a non-extractable AES-GCM CryptoKey stored in IndexedDB: WebCrypto
// can use it to encrypt/decrypt, but its raw bytes are never readable by JS, even this
// module. The master key is wrapped with it and tagged with an expiry that mirrors the
// visible inactivity timer, so a cold restart within that window resumes with no prompt,
// and one past the deadline re-locks exactly as before.
//
// Trade-off (accepted): on-device access within the grace window bypasses password/Face
// ID entirely, same as the visible auto-lock timer already does for a live session.

const DB_NAME = 'pv_resume';
const STORE_NAME = 'keys';
const KEY_ID = 'wrapping_key';

const RESUME_BLOB = 'pv_resume_blob';
const RESUME_DEADLINE = 'pv_resume_deadline';

function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateWrappingKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return key;
}

/**
 * Wrap and persist the master key so a cold restart within `ttlMs` can resume without
 * re-prompting. `ttlMs === 0` matches the auto-lock setting's "disabled" value — persist
 * with no expiry.
 */
export async function persistResumeSession(masterKey: Uint8Array, ttlMs: number): Promise<void> {
  try {
    const key = await getOrCreateWrappingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, masterKey.buffer as ArrayBuffer);
    localStorage.setItem(RESUME_BLOB, bytesToBase64(iv) + ':' + bytesToBase64(ciphertext));
    localStorage.setItem(RESUME_DEADLINE, ttlMs === 0 ? 'never' : String(Date.now() + ttlMs));
  } catch {
    // Resume is a convenience layer on top of the real unlock flow — if it fails,
    // the next cold start just falls back to a normal prompt.
  }
}

/** Push the deadline out on user activity, keeping it in sync with the visible inactivity timer. */
export function refreshResumeDeadline(ttlMs: number): void {
  if (localStorage.getItem(RESUME_BLOB) === null) return;
  localStorage.setItem(RESUME_DEADLINE, ttlMs === 0 ? 'never' : String(Date.now() + ttlMs));
}

export function clearResumeSession(): void {
  localStorage.removeItem(RESUME_BLOB);
  localStorage.removeItem(RESUME_DEADLINE);
}

/** Returns the unwrapped master key if a non-expired resume session exists, else null. */
export async function tryResumeSession(): Promise<Uint8Array | null> {
  const blob = localStorage.getItem(RESUME_BLOB);
  const deadline = localStorage.getItem(RESUME_DEADLINE);
  if (!blob || !deadline) return null;
  if (deadline !== 'never' && Date.now() >= Number(deadline)) {
    clearResumeSession();
    return null;
  }
  try {
    const key = await getOrCreateWrappingKey();
    const [ivB64, ciphertextB64] = blob.split(':');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivB64).buffer as ArrayBuffer },
      key,
      base64ToBytes(ciphertextB64).buffer as ArrayBuffer,
    );
    return new Uint8Array(plaintext);
  } catch {
    clearResumeSession();
    return null;
  }
}
