/**
 * Biometric unlock service.
 *
 * Flow:
 *   First setup:
 *     1. User enters master password → Argon2id derives 32-byte key
 *     2. enrollBiometric() stores the key in the OS keychain, gated by biometric
 *
 *   Subsequent unlocks:
 *     1. unlockWithBiometric() triggers Face ID / fingerprint prompt
 *     2. On success, OS returns the stored key
 *     3. Key is used to open SQLCipher DB
 *
 * Security:
 *   - ACCESS_CONTROL.BIOMETRY_CURRENT_SET: invalidated if new face/finger enrolled
 *   - ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: key cannot leave device
 */

import * as Keychain from 'react-native-keychain';
import * as LocalAuthentication from 'expo-local-authentication';

const KEYCHAIN_SERVICE = 'com.passwordvault.vaultkey';
const MAX_BIOMETRIC_ATTEMPTS = 3;
const FAILURE_STORAGE_KEY = 'biometric_failures';

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface BiometricCapability {
  available: boolean;
  type: 'faceId' | 'fingerprint' | 'iris' | 'none';
}

/** Check what biometrics are available on this device. */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return { available: false, type: 'none' };

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { available: false, type: 'none' };

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return { available: true, type: 'faceId' };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return { available: true, type: 'fingerprint' };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return { available: true, type: 'iris' };
  }
  return { available: false, type: 'none' };
}

/**
 * Store the derived key in the OS keychain, gated by biometric authentication.
 * Call this after the user first sets their master password.
 */
export async function enrollBiometric(derivedKey: Uint8Array): Promise<boolean> {
  try {
    const base64Key = Buffer.from(derivedKey).toString('base64');
    await Keychain.setGenericPassword('vault', base64Key, {
      service: KEYCHAIN_SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
    });
    await resetFailureCount();
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to retrieve the vault key via biometric authentication.
 * Returns the 32-byte key on success, null if biometrics unavailable/failed.
 */
export async function unlockWithBiometric(): Promise<Uint8Array | null> {
  const failures = await getFailureCount();
  if (failures >= MAX_BIOMETRIC_ATTEMPTS) {
    return null; // force master password
  }

  try {
    const credentials = await Keychain.getGenericPassword({
      service: KEYCHAIN_SERVICE,
      authenticationPrompt: {
        title: 'Unlock Password Vault',
        subtitle: 'Use biometrics to unlock your vault',
        cancel: 'Use Password',
      },
    });

    if (!credentials) {
      await incrementFailureCount();
      return null;
    }

    await resetFailureCount();
    return new Uint8Array(Buffer.from(credentials.password, 'base64'));
  } catch {
    await incrementFailureCount();
    return null;
  }
}

/** Check if a biometric key is stored (i.e., user has enrolled biometrics). */
export async function isBiometricEnrolled(): Promise<boolean> {
  try {
    const credentials = await Keychain.hasInternetCredentials(KEYCHAIN_SERVICE);
    return !!credentials;
  } catch {
    return false;
  }
}

/** Remove the biometric key from keychain (e.g., on password change). */
export async function revokeBiometric(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
    await resetFailureCount();
  } catch {
    // ignore if not enrolled
  }
}

// ─── Failure counter ──────────────────────────────────────────────────────────

async function getFailureCount(): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(FAILURE_STORAGE_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function incrementFailureCount(): Promise<void> {
  const count = await getFailureCount();
  await AsyncStorage.setItem(FAILURE_STORAGE_KEY, String(count + 1));
}

async function resetFailureCount(): Promise<void> {
  await AsyncStorage.removeItem(FAILURE_STORAGE_KEY);
}
