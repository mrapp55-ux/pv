/**
 * First-time setup screen.
 *
 * Two paths:
 *   A. Create new vault — generate salt, derive key, init DB, upload to Drive.
 *   B. Join existing vault from Google Drive — sign in, download vault.db + vault.salt,
 *      enter master password to verify, then navigate to vault.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { estimateEntropy, generatePassword } from '@vault/shared-crypto';
import { deriveAndInitSession, generateSaltBase64 } from '../../services/keyDerivation';
import { openDatabase, initMetadata, closeDatabase } from '../../services/database';
import { enrollBiometric, getBiometricCapability } from '../../services/biometric';
import {
  signInWithGoogle,
  driveVaultExists,
  downloadVaultFromDrive,
  syncAfterWrite,
  isGoogleSignedIn,
} from '../../services/sync';
import { useVaultStore } from '../../store/vault';

const MIN_ENTROPY_BITS = 40;

export default function SetupScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [joiningDrive, setJoiningDrive] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const { setAuthState, setDeviceId, setEntries } = useVaultStore();

  const entropy = estimateEntropy(password);
  const entropyLabel = entropy < 28 ? 'Weak' : entropy < 40 ? 'Fair' : entropy < 60 ? 'Strong' : 'Very Strong';
  const entropyColor = entropy < 28 ? '#e74c3c' : entropy < 40 ? '#f39c12' : entropy < 60 ? '#2ecc71' : '#27ae60';

  async function handleSetup() {
    if (!password) return;
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Please re-enter your master password.');
      return;
    }
    if (entropy < MIN_ENTROPY_BITS) {
      Alert.alert(
        'Password too weak',
        `~${Math.floor(entropy)} bits of entropy. Use a longer passphrase (aim for 4+ random words).`,
      );
      return;
    }

    setLoading(true);
    try {
      const deviceId = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        Math.random().toString() + Date.now(),
        { encoding: Crypto.CryptoEncoding.HEX },
      );
      await SecureStore.setItemAsync('device_id', deviceId);

      const saltBase64 = generateSaltBase64();
      await deriveAndInitSession(password, saltBase64);
      await SecureStore.setItemAsync('vault_salt', saltBase64);

      const vaultId = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        saltBase64 + deviceId,
        { encoding: Crypto.CryptoEncoding.HEX },
      );

      await openDatabase();
      await initMetadata({ version: 1, createdAt: Date.now(), salt: saltBase64, vaultId, deviceId });
      setDeviceId(deviceId);

      const bioCap = await getBiometricCapability();
      if (bioCap.available) {
        const { getMasterKey } = await import('@vault/shared-crypto');
        const enrolled = await new Promise<boolean>(resolve => {
          Alert.alert(
            `Enable ${bioCap.type === 'faceId' ? 'Face ID' : 'Fingerprint'} Unlock?`,
            'You can unlock your vault without typing your master password.',
            [
              { text: 'Not Now', onPress: () => resolve(false) },
              { text: 'Enable', onPress: () => resolve(true) },
            ],
          );
        });
        if (enrolled) await enrollBiometric(getMasterKey());
      }

      // Upload new vault to Google Drive in background
      syncAfterWrite();

      setAuthState('unlocked');
    } catch (e) {
      Alert.alert('Setup failed', String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinDrive() {
    setJoinLoading(true);
    try {
      if (!isGoogleSignedIn()) {
        await signInWithGoogle();
      }
      const exists = await driveVaultExists();
      if (!exists) {
        Alert.alert(
          'No vault found',
          'No Password Vault was found in your Google Drive. Create a new vault instead.',
        );
        return;
      }
      setJoiningDrive(true);
    } catch (e) {
      Alert.alert('Google Sign-In failed', String(e));
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleJoinUnlock() {
    if (!joinPassword) return;
    setJoinLoading(true);
    try {
      // Download vault.db + vault.salt from Drive (stores salt in SecureStore)
      await downloadVaultFromDrive();

      const saltBase64 = await SecureStore.getItemAsync('vault_salt');
      if (!saltBase64) throw new Error('Salt not found after download');

      // Derive key from password + downloaded salt
      await deriveAndInitSession(joinPassword, saltBase64);

      // Open the downloaded DB (if key is wrong, openDatabase will throw)
      await openDatabase();

      // Store a device ID for this new device
      const deviceId = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        Math.random().toString() + Date.now(),
        { encoding: Crypto.CryptoEncoding.HEX },
      );
      await SecureStore.setItemAsync('device_id', deviceId);
      setDeviceId(deviceId);

      const bioCap = await getBiometricCapability();
      if (bioCap.available) {
        const { getMasterKey } = await import('@vault/shared-crypto');
        const enroll = await new Promise<boolean>(resolve => {
          Alert.alert(
            'Enable Biometric Unlock?',
            'Use Face ID or fingerprint to unlock on this device.',
            [
              { text: 'Not Now', onPress: () => resolve(false) },
              { text: 'Enable', onPress: () => resolve(true) },
            ],
          );
        });
        if (enroll) await enrollBiometric(getMasterKey());
      }

      const { listEntries } = await import('../../services/database');
      setEntries(await listEntries());
      setAuthState('unlocked');
    } catch {
      closeDatabase();
      Alert.alert('Incorrect Password', 'The master password did not match this vault.');
    } finally {
      setJoinLoading(false);
    }
  }

  function useSuggestedPassword() {
    const pw = generatePassword({ length: 24 });
    setPassword(pw);
    setConfirm(pw);
    setShowPassword(true);
  }

  // ── Join Drive flow ────────────────────────────────────────────────────────
  if (joiningDrive) {
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>☁</Text>
          <Text style={styles.title}>Join Existing Vault</Text>
          <Text style={styles.subtitle}>
            A Password Vault was found in your Google Drive. Enter your master password to unlock it on this device.
          </Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.label}>Master Password</Text>
          <TextInput
            style={styles.input}
            value={joinPassword}
            onChangeText={setJoinPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter your master password…"
            placeholderTextColor="#888"
            onSubmitEditing={handleJoinUnlock}
            returnKeyType="go"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, joinLoading && styles.btnDisabled]}
            onPress={handleJoinUnlock}
            disabled={joinLoading}
          >
            {joinLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Unlock & Join</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.suggestionBtn} onPress={() => setJoiningDrive(false)}>
            <Text style={[styles.suggestionBtnText, { color: '#888' }]}>← Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ── Create new vault flow ──────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.logo}>🔐</Text>
        <Text style={styles.title}>Create Your Vault</Text>
        <Text style={styles.subtitle}>
          Your master password encrypts everything. It is never stored — if you forget it, your
          data cannot be recovered.
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Master Password</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter a strong passphrase…"
            placeholderTextColor="#888"
          />
          <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowPassword(v => !v)}>
            <Text style={styles.toggleBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {password.length > 0 && (
          <View style={styles.strengthRow}>
            <View style={[styles.strengthBar, { width: `${Math.min((entropy / 80) * 100, 100)}%` as `${number}%`, backgroundColor: entropyColor }]} />
            <Text style={[styles.strengthLabel, { color: entropyColor }]}>{entropyLabel}</Text>
          </View>
        )}

        <Text style={styles.label}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Re-enter your passphrase…"
          placeholderTextColor="#888"
        />

        <TouchableOpacity style={styles.suggestionBtn} onPress={useSuggestedPassword}>
          <Text style={styles.suggestionBtnText}>Generate Strong Password</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={handleSetup}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create Vault</Text>}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.driveBtn, joinLoading && styles.btnDisabled]}
          onPress={handleJoinDrive}
          disabled={joinLoading}
        >
          {joinLoading
            ? <ActivityIndicator color="#7c83fd" />
            : <Text style={styles.driveBtnText}>☁  Join Existing Vault via Google Drive</Text>
          }
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#1a1a2e', padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 64, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#aaa', textAlign: 'center', lineHeight: 20 },
  form: { gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#ccc', marginBottom: 4 },
  inputRow: { flexDirection: 'row', gap: 8 },
  inputFlex: { flex: 1 },
  input: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  toggleBtn: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  toggleBtnText: { color: '#7c83fd', fontWeight: '600' },
  strengthRow: { height: 6, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden' },
  strengthBar: { height: '100%', borderRadius: 3 },
  strengthLabel: { fontSize: 12, marginTop: 4, textAlign: 'right' },
  suggestionBtn: { alignItems: 'center', padding: 10 },
  suggestionBtnText: { color: '#7c83fd', fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: '#7c83fd',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#3a3a5e' },
  dividerText: { color: '#666', fontSize: 13 },
  driveBtn: {
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  driveBtnText: { color: '#7c83fd', fontSize: 16, fontWeight: '600' },
});
