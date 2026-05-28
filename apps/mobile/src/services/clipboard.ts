/**
 * Clipboard service with automatic 30-second clear.
 *
 * Passwords copied to clipboard are wiped after CLEAR_DELAY_MS.
 * Only one clipboard timer runs at a time — copying a new value cancels the old timer.
 */

import Clipboard from '@react-native-clipboard/clipboard';

const CLEAR_DELAY_MS = 30_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let clearCallback: (() => void) | null = null;

/**
 * Copy a sensitive value to clipboard and schedule automatic clearing.
 * @param value  The plaintext to copy (e.g., a password)
 * @param onCleared  Optional callback fired when the clipboard is cleared
 * @returns Cancel function — call it if you want to prevent auto-clear
 */
export function copySecure(
  value: string,
  onCleared?: () => void,
): () => void {
  // Cancel any pending clear from a previous copy
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  Clipboard.setString(value);
  clearCallback = onCleared ?? null;

  clearTimer = setTimeout(() => {
    Clipboard.setString('');
    clearTimer = null;
    clearCallback?.();
    clearCallback = null;
  }, CLEAR_DELAY_MS);

  return () => {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
      clearCallback = null;
    }
  };
}

/** Immediately clear the clipboard and cancel any pending timer. */
export function clearClipboard(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  Clipboard.setString('');
  clearCallback = null;
}

/** Remaining milliseconds until auto-clear (0 if no timer active). */
export function clearTimerRemainingMs(): number {
  return clearTimer !== null ? CLEAR_DELAY_MS : 0;
}
