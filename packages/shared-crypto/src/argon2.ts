/**
 * Argon2id key derivation — wraps the platform crypto.
 *
 * On React Native, swap this import for `react-native-argon2`.
 * On Node.js / Jest / Tauri sidecar, the `argon2` npm package is used.
 *
 * The interface is identical so call-sites never change.
 */

export interface Argon2Params {
  /** Memory cost in KiB. Default 65536 = 64 MB. */
  memoryCost?: number;
  /** Time cost (iterations). Default 3. */
  timeCost?: number;
  /** Parallelism. Default 4. */
  parallelism?: number;
}

export interface DeriveKeyResult {
  /** 32-byte derived key as Uint8Array */
  key: Uint8Array;
  /** 16-byte random salt as Uint8Array (only populated when a new salt was generated) */
  salt: Uint8Array;
}

const DEFAULTS: Required<Argon2Params> = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

/**
 * Derive a 32-byte AES-256 key from a master password using Argon2id.
 *
 * The salt must be stored (unencrypted) alongside the vault so the key
 * can be re-derived on every unlock. The master password is NEVER stored.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = {},
): Promise<Uint8Array> {
  const { memoryCost, timeCost, parallelism } = { ...DEFAULTS, ...params };

  // Node.js / Jest path — will be replaced on React Native by the native module
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const argon2 = await import('argon2');
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
    hashLength: 32,
    salt: Buffer.from(salt),
    raw: true,
  });
  return new Uint8Array(hash);
}

/** Generate a cryptographically random 16-byte salt. */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(salt);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require('crypto') as typeof import('crypto');
    const bytes = randomBytes(16);
    salt.set(bytes);
  }
  return salt;
}
