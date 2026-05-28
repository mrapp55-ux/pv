/**
 * In-memory key lifecycle manager.
 *
 * Holds the 32-byte master key in a Uint8Array and zeroes it on lock.
 * The JS runtime does not guarantee GC timing, so zeroing is best-effort
 * on the JS side — the native layer (SQLCipher) holds the authoritative key.
 *
 * Call sequence:
 *   1. init(password, salt)   — derives key, opens DB
 *   2. getKey()               — returns key during active session
 *   3. lock()                 — zeroes key, marks session ended
 */

import { deriveKey } from './argon2.js';
import { fieldKey } from './hkdf.js';
import type { Argon2Params } from './argon2.js';

interface SessionState {
  masterKey: Uint8Array;
  fieldKeys: Map<string, Uint8Array>;
  unlockedAt: number;
}

let session: SessionState | null = null;

/**
 * Start a session from a raw key (used when biometrics retrieve the stored key directly).
 * The key must be 32 bytes — it replaces the normal Argon2id derivation path.
 */
export async function initSessionFromKey(key: Uint8Array): Promise<void> {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  if (session) lock();
  const masterKey = new Uint8Array(32);
  masterKey.set(key);
  session = { masterKey, fieldKeys: new Map(), unlockedAt: Date.now() };
}

/**
 * Derive the master key from the password + salt and start a session.
 * Must be called before any getKey() / fieldKey() calls.
 */
export async function initSession(
  password: string,
  salt: Uint8Array,
  params?: Argon2Params,
): Promise<void> {
  if (session) lock(); // clean up any previous session
  const masterKey = await deriveKey(password, salt, params);
  session = {
    masterKey,
    fieldKeys: new Map(),
    unlockedAt: Date.now(),
  };
}

/**
 * Get the 32-byte master key for SQLCipher.
 * Throws if the vault is locked.
 */
export function getMasterKey(): Uint8Array {
  if (!session) throw new Error('Vault is locked');
  return session.masterKey;
}

/**
 * Get (or derive and cache) the per-field encryption key.
 * Throws if the vault is locked.
 */
export async function getFieldKey(field: string): Promise<Uint8Array> {
  if (!session) throw new Error('Vault is locked');
  if (!session.fieldKeys.has(field)) {
    const key = await fieldKey(session.masterKey, field);
    session.fieldKeys.set(field, key);
  }
  return session.fieldKeys.get(field)!;
}

/** True when a session is active (vault is unlocked). */
export function isUnlocked(): boolean {
  return session !== null;
}

/** Timestamp (ms) when the vault was last unlocked. */
export function unlockedAt(): number | null {
  return session?.unlockedAt ?? null;
}

/**
 * Zero all key material and end the session.
 * Safe to call multiple times.
 */
export function lock(): void {
  if (!session) return;
  session.masterKey.fill(0);
  for (const k of session.fieldKeys.values()) {
    k.fill(0);
  }
  session.fieldKeys.clear();
  session = null;
}
