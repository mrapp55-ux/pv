import type { SidecarPayload } from '../types';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Derive the sidecar decryption key from the master key using HKDF-SHA256.
 * Matches Rust: hkdf_field_key(master, "pwa_sidecar")
 *   - No HKDF salt (Rust `None` → 32 zero bytes per RFC 5869)
 *   - Info: "field_enc:pwa_sidecar"
 */
async function deriveSidecarKey(masterKeyBytes: Uint8Array): Promise<CryptoKey> {
  // Copy into a plain ArrayBuffer so WebCrypto's strict typing is satisfied
  const keyBuffer = new Uint8Array(masterKeyBytes).buffer as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', keyBuffer, 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),   // 32 zero bytes — matches Rust Hkdf::new(None, master)
      info: new TextEncoder().encode('field_enc:pwa_sidecar'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/**
 * Decrypt vault.enc and return the parsed sidecar payload.
 * Wire format (base64): [12-byte nonce][AES-256-GCM ciphertext + 16-byte tag]
 */
export async function decryptSidecar(
  masterKeyBytes: Uint8Array,
  encryptedB64: string,
): Promise<SidecarPayload> {
  const sidecarKey = await deriveSidecarKey(masterKeyBytes);
  const cipherBytes = base64ToBytes(encryptedB64);
  const iv = cipherBytes.slice(0, 12);
  const ciphertext = cipherBytes.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sidecarKey,
    ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as SidecarPayload;
}
