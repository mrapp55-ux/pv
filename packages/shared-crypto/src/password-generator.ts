/** Cryptographically secure password generator. Never uses Math.random(). */

const CHARSET = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
} as const;

export interface PasswordOptions {
  length?: number;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
}

/**
 * Generate a random password using CSPRNG.
 * Defaults: 20 chars, all character classes.
 */
export function generatePassword(opts: PasswordOptions = {}): string {
  const {
    length = 20,
    uppercase = true,
    digits = true,
    symbols = true,
  } = opts;

  let alphabet = CHARSET.lower;
  const required: string[] = [pickRandom(CHARSET.lower)];

  if (uppercase) {
    alphabet += CHARSET.upper;
    required.push(pickRandom(CHARSET.upper));
  }
  if (digits) {
    alphabet += CHARSET.digits;
    required.push(pickRandom(CHARSET.digits));
  }
  if (symbols) {
    alphabet += CHARSET.symbols;
    required.push(pickRandom(CHARSET.symbols));
  }

  const remaining = length - required.length;
  if (remaining < 0) throw new Error('Password length too short for selected character classes');

  const chars: string[] = [];
  for (let i = 0; i < remaining; i++) {
    chars.push(pickRandom(alphabet));
  }

  // Shuffle required + random chars
  const all = [...required, ...chars];
  cryptoShuffle(all);
  return all.join('');
}

/** Estimate password entropy in bits using zxcvbn-style character set size. */
export function estimateEntropy(password: string): number {
  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;
  return Math.log2(charsetSize) * password.length;
}

function pickRandom(chars: string): string {
  const array = new Uint32Array(1);
  getSecureRandom(array);
  return chars[array[0] % chars.length]!;
}

function cryptoShuffle(arr: string[]): void {
  const indices = new Uint32Array(arr.length);
  getSecureRandom(indices);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = indices[i]! % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function getSecureRandom(array: Uint32Array): void {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
    return;
  }
  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomFillSync } = require('crypto') as typeof import('crypto');
  const buf = Buffer.alloc(array.byteLength);
  randomFillSync(buf);
  const view = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  array.set(view);
}
