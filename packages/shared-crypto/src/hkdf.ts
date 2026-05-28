/**
 * HKDF-SHA256 key expansion.
 *
 * Used to derive per-field encryption keys from the master derived key:
 *   fieldKey = HKDF(masterKey, info="field_enc:<fieldName>", salt=empty)
 *
 * This ensures each field uses a distinct key, so compromising one
 * field's key doesn't compromise others.
 */

function getNodeCrypto() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as typeof import('crypto');
}

function isSubtleCryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined'
  );
}

/**
 * Derive a 32-byte subkey using HKDF-SHA256.
 * @param inputKey  The master key (32 bytes from Argon2id)
 * @param info  Context string distinguishing this subkey's purpose
 */
export async function hkdfExpand(inputKey: Uint8Array, info: string): Promise<Uint8Array> {
  if (isSubtleCryptoAvailable()) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      inputKey,
      { name: 'HKDF' },
      false,
      ['deriveKey'],
    );
    const derived = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(info),
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const raw = await crypto.subtle.exportKey('raw', derived);
    return new Uint8Array(raw);
  }

  // Node.js fallback
  const nodeCrypto = getNodeCrypto();
  return new Promise((resolve, reject) => {
    nodeCrypto.hkdf(
      'sha256',
      Buffer.from(inputKey),
      Buffer.alloc(0),
      Buffer.from(info, 'utf8'),
      32,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(new Uint8Array(derivedKey));
      },
    );
  });
}

/** Derive the field encryption key for a named field. */
export async function fieldKey(masterKey: Uint8Array, fieldName: string): Promise<Uint8Array> {
  return hkdfExpand(masterKey, `field_enc:${fieldName}`);
}
