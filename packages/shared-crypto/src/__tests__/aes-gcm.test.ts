import { encrypt, decrypt } from '../aes-gcm.js';

function randomKey(): Uint8Array {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i + 1;
  return k;
}

describe('AES-256-GCM', () => {
  it('round-trips a plaintext string', async () => {
    const key = randomKey();
    const plaintext = 'super-secret-password-123!';
    const ciphertext = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each call (random IV)', async () => {
    const key = randomKey();
    const ct1 = await encrypt(key, 'same plaintext');
    const ct2 = await encrypt(key, 'same plaintext');
    expect(ct1).not.toBe(ct2);
  });

  it('throws on tampered ciphertext', async () => {
    const key = randomKey();
    const ct = await encrypt(key, 'hello');
    const buf = Buffer.from(ct, 'base64');
    buf[20] ^= 0xff; // flip bits in ciphertext body
    await expect(decrypt(key, buf.toString('base64'))).rejects.toThrow();
  });

  it('throws with wrong key', async () => {
    const key1 = randomKey();
    const key2 = new Uint8Array(32).fill(99);
    const ct = await encrypt(key1, 'hello');
    await expect(decrypt(key2, ct)).rejects.toThrow();
  });

  it('handles empty string', async () => {
    const key = randomKey();
    const ct = await encrypt(key, '');
    expect(await decrypt(key, ct)).toBe('');
  });

  it('handles unicode content', async () => {
    const key = randomKey();
    const text = '密码: héllo wörld 🔐';
    expect(await decrypt(key, await encrypt(key, text))).toBe(text);
  });
});
