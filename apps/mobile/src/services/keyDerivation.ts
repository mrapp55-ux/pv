/**
 * Mobile-specific Argon2id key derivation using react-native-argon2.
 *
 * This replaces the Node.js `argon2` npm package used in shared-crypto tests.
 * The interface is identical — initSession() in key-manager calls this on mobile.
 *
 * Import this module INSTEAD of calling shared-crypto's deriveKey directly.
 * It calls initSessionFromKey() with the derived key so the rest of the
 * key-manager session lifecycle works normally.
 */

import argon2 from 'react-native-argon2';
import { initSessionFromKey } from '@vault/shared-crypto';

const ARGON2_CONFIG = {
  iterations: 3,
  memory: 65536, // 64 MB
  parallelism: 4,
  hashLength: 32,
  mode: 'argon2id' as const,
};

/**
 * Derive a 32-byte key from the master password and open a vault session.
 * @param password  Master password (UTF-8 string)
 * @param saltBase64  Base64-encoded 16-byte salt (stored in SecureStore)
 */
export async function deriveAndInitSession(
  password: string,
  saltBase64: string,
): Promise<void> {
  const result = await argon2(password, saltBase64, ARGON2_CONFIG);
  // react-native-argon2 returns the hash as a hex string
  const keyBytes = new Uint8Array(
    result.rawHash.match(/.{1,2}/g)!.map(b => parseInt(b, 16)),
  );
  await initSessionFromKey(keyBytes);
}

/** Generate a cryptographically random 16-byte salt and return it as base64. */
export function generateSaltBase64(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return Buffer.from(salt).toString('base64');
}
