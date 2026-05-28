/**
 * AES-256-GCM authenticated encryption for individual fields.
 *
 * Used as a second layer on top of SQLCipher's full-database encryption.
 * Even if the DB is opened, individual passwords and notes remain encrypted.
 *
 * Wire format (all base64-encoded together as a single string):
 *   [ 12-byte IV ][ ciphertext ][ 16-byte GCM auth tag ]
 *
 * The auth tag is appended by SubtleCrypto automatically in the ciphertext.
 */

const IV_LENGTH = 12; // 96-bit IV, NIST recommended for GCM

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
 * Encrypt plaintext with AES-256-GCM.
 * @param key  32-byte field encryption key (from HKDF)
 * @param plaintext  UTF-8 string to encrypt
 * @returns base64 string: IV || ciphertext+tag
 */
export async function encrypt(key: Uint8Array, plaintext: string): Promise<string> {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');

  const iv = new Uint8Array(IV_LENGTH);

  if (isSubtleCryptoAvailable()) {
    crypto.getRandomValues(iv);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const encoder = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoder.encode(plaintext),
    );
    const result = new Uint8Array(IV_LENGTH + cipherBuf.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(cipherBuf), IV_LENGTH);
    return Buffer.from(result).toString('base64');
  }

  // Node.js fallback
  const nodeCrypto = getNodeCrypto();
  const ivBuf = nodeCrypto.randomBytes(IV_LENGTH);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(key), ivBuf);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([ivBuf, encrypted, tag]);
  return out.toString('base64');
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * @param key  32-byte field encryption key
 * @param ciphertext  base64 string produced by `encrypt`
 * @returns Decrypted plaintext string
 * @throws if authentication tag is invalid (tampered data)
 */
export async function decrypt(key: Uint8Array, ciphertext: string): Promise<string> {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');

  const data = Buffer.from(ciphertext, 'base64');

  if (isSubtleCryptoAvailable()) {
    const iv = data.subarray(0, IV_LENGTH);
    const payload = data.subarray(IV_LENGTH);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      payload,
    );
    return new TextDecoder().decode(plainBuf);
  }

  // Node.js fallback
  const nodeCrypto = getNodeCrypto();
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - 16);
  const payload = data.subarray(IV_LENGTH, data.length - 16);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
  decipher.setAuthTag(tag);
  return decipher.update(payload).toString('utf8') + decipher.final('utf8');
}
