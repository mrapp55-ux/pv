/**
 * Unlock screen.
 *
 * Attempts biometric unlock first. Falls back to master password after 3 failures.
 * After 10 consecutive master password failures, enforces exponential lockout.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { deriveAndInitSession } from '../../services/keyDerivation';
import { openDatabase, closeDatabase, listEntries } from '../../services/database';
import { unlockWithBiometric, getBiometricCapability, isBiometricEnrolled } from '../../services/biometric';
import { syncOnOpen } from '../../services/sync';
import { useVaultStore } from '../../store/vault';

const MAX_PASSWORD_FAILURES = 10;
const LOCKOUT_STORAGE_KEY = 'pw_failures';
const LOCKOUT_UNTIL_KEY = 'pw_locked_until';

export default function UnlockScreen() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBiometric, setShowBiometric] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number>(0);
  const { setAuthState, setEntries } = useVaultStore();

  useEffect(() => {
    void init();
  }, []);

  const init = useCallback(async () => {
    const [enrolled, cap, until] = await Promise.all([
      isBiometricEnrolled(),
      getBiometricCapability(),
      SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY).then(v => (v ? parseInt(v, 10) : 0)),
    ]);
    setShowBiometric(enrolled && cap.available);
    setLockoutUntil(until);

    if (enrolled && cap.available && until < Date.now()) {
      await attemptBiometric();
    }
  }, []);

  async function attemptBiometric() {
    setLoading(true);
    try {
      const key = await unlockWithBiometric();
      if (key) {
        await openWithKey(key);
      }
    } finally {
      setLoading(false);
    }
  }

  async function openWithKey(key: Uint8Array) {
    const { lock, initSessionFromKey } = await import('@vault/shared-crypto');
    lock();
    await initSessionFromKey(key);

    await openDatabase();

    // Download newer vault from Drive if available (runs silently)
    const newerVault = await syncOnOpen();
    if (newerVault) {
      closeDatabase();
      await openDatabase();
    }

    const entries = await listEntries();
    setEntries(entries);
    setAuthState('unlocked');
  }

  async function handlePasswordUnlock() {
    if (!password) return;

    const until = parseInt((await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY)) ?? '0', 10);
    if (until > Date.now()) {
      const mins = Math.ceil((until - Date.now()) / 60000);
      Alert.alert('Account Locked', `Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    setLoading(true);
    try {
      const saltBase64 = await SecureStore.getItemAsync('vault_salt');
      if (!saltBase64) throw new Error('Vault salt not found');

      await deriveAndInitSession(password, saltBase64);
      await openDatabase();

      // Verify by reading metadata (will throw if key is wrong)
      const entries = await listEntries();

      await resetFailures();

      // Download newer vault from Drive if available (runs silently)
      const newerVault = await syncOnOpen();
      if (newerVault) {
        const { closeDatabase } = await import('../../services/database');
        closeDatabase();
        await openDatabase();
        const refreshed = await listEntries();
        setEntries(refreshed);
      } else {
        setEntries(entries);
      }

      setAuthState('unlocked');
    } catch {
      const failures = await incrementFailures();
      if (failures >= MAX_PASSWORD_FAILURES) {
        const lockUntil = Date.now() + lockoutDuration(failures) * 60_000;
        await SecureStore.setItemAsync(LOCKOUT_UNTIL_KEY, String(lockUntil));
        setLockoutUntil(lockUntil);
        Alert.alert(
          'Account Locked',
          `Too many failed attempts. Locked for ${lockoutDuration(failures)} minute(s).`,
        );
      } else {
        Alert.alert('Incorrect Password', `${MAX_PASSWORD_FAILURES - failures} attempt(s) remaining.`);
      }
    } finally {
      setLoading(false);
      setPassword('');
    }
  }

  const isLocked = lockoutUntil > Date.now();

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🔐</Text>
      <Text style={styles.title}>Unlock Vault</Text>

      {showBiometric && !isLocked && (
        <TouchableOpacity style={styles.biometricBtn} onPress={attemptBiometric} disabled={loading}>
          <Text style={styles.biometricIcon}>👤</Text>
          <Text style={styles.biometricText}>Use Face ID / Fingerprint</Text>
        </TouchableOpacity>
      )}

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{showBiometric ? 'or use password' : 'Enter master password'}</Text>
        <View style={styles.dividerLine} />
      </View>

      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Master password"
        placeholderTextColor="#888"
        editable={!isLocked && !loading}
        onSubmitEditing={handlePasswordUnlock}
        returnKeyType="go"
      />

      {isLocked && (
        <Text style={styles.lockoutText}>
          Locked until {new Date(lockoutUntil).toLocaleTimeString()}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.unlockBtn, (isLocked || loading) && styles.btnDisabled]}
        onPress={handlePasswordUnlock}
        disabled={isLocked || loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.unlockBtnText}>Unlock</Text>}
      </TouchableOpacity>
    </View>
  );
}

function lockoutDuration(failures: number): number {
  if (failures >= 20) return 240; // 4 hours
  if (failures >= 15) return 30;
  if (failures >= 13) return 5;
  return 1;
}

async function incrementFailures(): Promise<number> {
  const val = await SecureStore.getItemAsync(LOCKOUT_STORAGE_KEY);
  const next = (val ? parseInt(val, 10) : 0) + 1;
  await SecureStore.setItemAsync(LOCKOUT_STORAGE_KEY, String(next));
  return next;
}

async function resetFailures(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCKOUT_STORAGE_KEY);
  await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: { fontSize: 72, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 32 },
  biometricBtn: {
    alignItems: 'center',
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  biometricIcon: { fontSize: 48, marginBottom: 8 },
  biometricText: { color: '#7c83fd', fontSize: 16, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 16, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#3a3a5e' },
  dividerText: { color: '#888', fontSize: 12 },
  input: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a5e',
    width: '100%',
    marginBottom: 16,
  },
  lockoutText: { color: '#e74c3c', fontSize: 13, marginBottom: 12 },
  unlockBtn: {
    backgroundColor: '#7c83fd',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    width: '100%',
  },
  btnDisabled: { opacity: 0.5 },
  unlockBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
