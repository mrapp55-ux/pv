import { argon2id } from 'hash-wasm';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Key provider abstraction ──────────────────────────────────────────────────
//
// All key derivation flows through this interface.
// Currently uses password + Argon2id.
// To add Face ID later: implement a WebAuthn PRF provider and swap `keyProvider`.

export interface KeyProvider {
  /** Derive the 32-byte master key from user credentials + vault salt. */
  deriveKey(password: string, saltB64: string): Promise<Uint8Array>;
}

const passwordProvider: KeyProvider = {
  async deriveKey(password, saltB64) {
    const salt = base64ToBytes(saltB64);
    // Parameters must match the desktop Rust backend: m=65536, t=3, p=4, len=32
    return argon2id({
      password,
      salt,
      iterations: 3,
      memorySize: 65536,
      parallelism: 4,
      hashLength: 32,
      outputType: 'binary',
    });
  },
};

// Swap this to a Face ID / WebAuthn PRF provider when ready.
export const keyProvider: KeyProvider = passwordProvider;
