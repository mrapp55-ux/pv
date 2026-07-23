import { argon2id } from 'hash-wasm';

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ── Key provider abstraction ──────────────────────────────────────────────────

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

export const keyProvider: KeyProvider = passwordProvider;

// ── Face ID (WebAuthn PRF) ────────────────────────────────────────────────────

const FID_CRED_KEY    = 'pv_fid_cred_id';
const FID_WRAPPED_KEY = 'pv_fid_wrapped_key';

// Fixed PRF evaluation point — must be identical on enroll and authenticate.
// Value doesn't need to be secret; the credential's private key is the secret.
const PRF_INPUT: ArrayBuffer = new ArrayBuffer(32);

// PRF extension types not yet in standard TypeScript DOM lib
interface PRFInput   { eval: { first: ArrayBuffer } }
interface PRFResult  { results?: { first: ArrayBuffer } }

export function hasFaceIdEnrolled(): boolean {
  return localStorage.getItem(FID_CRED_KEY) !== null;
}

/**
 * Create a platform passkey with the PRF extension and wrap masterKey with the
 * PRF output using AES-256-GCM. Stores credential ID + wrapped key in
 * localStorage. Returns true on success, false if PRF is unsupported or the
 * user cancels.
 */
export async function enrollFaceId(masterKey: Uint8Array): Promise<boolean> {
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'PV', id: window.location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'vault',
          displayName: 'Vault',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   },  // ES256
          { type: 'public-key', alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        extensions: { prf: { eval: { first: PRF_INPUT } } as PRFInput } as AuthenticationExtensionsClientInputs,
      },
    }) as PublicKeyCredential | null;

    if (!credential) return false;

    const prfOutput = (credential.getClientExtensionResults() as { prf?: PRFResult })
      .prf?.results?.first;
    if (!prfOutput) return false; // device doesn't support PRF

    const aesKey = await crypto.subtle.importKey('raw', prfOutput, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, masterKey.buffer as ArrayBuffer);

    localStorage.setItem(FID_CRED_KEY,    bytesToBase64(credential.rawId));
    localStorage.setItem(FID_WRAPPED_KEY, bytesToBase64(iv) + ':' + bytesToBase64(ciphertext));
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate with the stored passkey, unwrap and return the master key.
 * Returns null if no credential is stored, the user cancels, or PRF fails.
 */
export async function unlockWithFaceId(): Promise<Uint8Array | null> {
  const credIdB64  = localStorage.getItem(FID_CRED_KEY);
  const wrappedB64 = localStorage.getItem(FID_WRAPPED_KEY);
  if (!credIdB64 || !wrappedB64) return null;

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: base64ToBytes(credIdB64).buffer as ArrayBuffer }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_INPUT } } as PRFInput } as AuthenticationExtensionsClientInputs,
      },
    }) as PublicKeyCredential | null;

    if (!assertion) return null;

    const prfOutput = (assertion.getClientExtensionResults() as { prf?: PRFResult })
      .prf?.results?.first;
    if (!prfOutput) return null;

    const aesKey = await crypto.subtle.importKey('raw', prfOutput, { name: 'AES-GCM' }, false, ['decrypt']);
    const [ivB64, ciphertextB64] = wrappedB64.split(':');
    const masterKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivB64).buffer as ArrayBuffer },
      aesKey,
      base64ToBytes(ciphertextB64),
    );
    return new Uint8Array(masterKey);
  } catch {
    return null;
  }
}
