import { initSession, getMasterKey, getFieldKey, isUnlocked, lock } from '../key-manager.js';
import { generateSalt } from '../argon2.js';

const TEST_PASSWORD = 'test-master-password-2024';

describe('key-manager', () => {
  afterEach(() => lock());

  it('initializes a session and returns a 32-byte master key', async () => {
    const salt = generateSalt();
    await initSession(TEST_PASSWORD, salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    expect(isUnlocked()).toBe(true);
    expect(getMasterKey()).toHaveLength(32);
  });

  it('derives deterministic key from same password+salt', async () => {
    const salt = generateSalt();
    await initSession(TEST_PASSWORD, salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const key1 = new Uint8Array(getMasterKey());
    lock();

    await initSession(TEST_PASSWORD, salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const key2 = getMasterKey();
    expect(key1).toEqual(key2);
  });

  it('derives different keys for different passwords', async () => {
    const salt = generateSalt();
    await initSession('password-a', salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const key1 = new Uint8Array(getMasterKey());
    lock();

    await initSession('password-b', salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const key2 = getMasterKey();
    expect(key1).not.toEqual(key2);
  });

  it('zeroes key on lock', async () => {
    const salt = generateSalt();
    await initSession(TEST_PASSWORD, salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const keyRef = getMasterKey();
    lock();
    expect(isUnlocked()).toBe(false);
    // The buffer should be zeroed
    expect(keyRef.every(b => b === 0)).toBe(true);
  });

  it('throws when accessing key while locked', () => {
    expect(() => getMasterKey()).toThrow('Vault is locked');
  });

  it('derives distinct field keys per field name', async () => {
    const salt = generateSalt();
    await initSession(TEST_PASSWORD, salt, { memoryCost: 256, timeCost: 1, parallelism: 1 });
    const passKey = await getFieldKey('password');
    const notesKey = await getFieldKey('notes');
    expect(passKey).not.toEqual(notesKey);
    expect(passKey).toHaveLength(32);
  });
});
