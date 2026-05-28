import { generatePassword, estimateEntropy } from '../password-generator.js';

describe('password-generator', () => {
  it('generates password of requested length', () => {
    for (const len of [8, 16, 20, 32, 64]) {
      expect(generatePassword({ length: len })).toHaveLength(len);
    }
  });

  it('includes all character classes by default', () => {
    const pw = generatePassword({ length: 40 });
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    expect(/[^a-zA-Z0-9]/.test(pw)).toBe(true);
  });

  it('generates unique passwords (no collision in 100 tries)', () => {
    const set = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(set.size).toBe(100);
  });

  it('respects uppercase=false', () => {
    const pw = generatePassword({ length: 40, uppercase: false });
    expect(/[A-Z]/.test(pw)).toBe(false);
  });

  it('respects symbols=false', () => {
    const pw = generatePassword({ length: 40, symbols: false });
    expect(/[^a-zA-Z0-9]/.test(pw)).toBe(false);
  });

  it('estimates entropy above 40 bits for a 20-char mixed password', () => {
    const pw = generatePassword({ length: 20 });
    expect(estimateEntropy(pw)).toBeGreaterThan(40);
  });
});
