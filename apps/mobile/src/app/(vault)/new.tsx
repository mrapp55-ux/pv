/**
 * New entry screen — creates a vault entry with encrypted password + notes.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { generatePassword, estimateEntropy } from '@vault/shared-crypto';
import { createEntry, listEntries } from '../../services/database';
import { syncAfterWrite } from '../../services/sync';
import { useVaultStore } from '../../store/vault';

export default function NewEntryScreen() {
  const router = useRouter();
  const { deviceId, setEntries } = useVaultStore();
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const entropy = estimateEntropy(password);

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please enter a title for this entry.');
      return;
    }
    if (!password) {
      Alert.alert('Password required', 'Please enter a password.');
      return;
    }
    if (!deviceId) return;

    setSaving(true);
    try {
      const id = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        title + Date.now() + Math.random(),
        { encoding: Crypto.CryptoEncoding.HEX },
      );

      await createEntry({
        id,
        title: title.trim(),
        username: username.trim() || null,
        password,
        url: url.trim() || null,
        notes: notes.trim() || null,
        modifiedBy: deviceId,
        deviceId,
      });

      setEntries(await listEntries());
      syncAfterWrite();
      router.back();
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setSaving(false);
    }
  }

  function fillGenerated() {
    setPassword(generatePassword({ length: 20 }));
    setShowPassword(true);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Field label="Title *" value={title} onChange={setTitle} placeholder="e.g. GitHub, Gmail" />
      <Field label="Username / Email" value={username} onChange={setUsername} placeholder="Optional" autoCapitalize="none" />

      <Text style={styles.label}>Password *</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputFlex]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Enter or generate a password"
          placeholderTextColor="#888"
        />
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowPassword(v => !v)}>
          <Text style={styles.iconBtnText}>{showPassword ? '🙈' : '👁'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={fillGenerated}>
          <Text style={styles.iconBtnText}>⚡</Text>
        </TouchableOpacity>
      </View>
      {password.length > 0 && (
        <Text style={{ color: entropy < 40 ? '#f39c12' : '#2ecc71', fontSize: 12, marginBottom: 12 }}>
          Entropy: ~{Math.floor(entropy)} bits {entropy < 40 ? '(weak)' : '(strong)'}
        </Text>
      )}

      <Field label="URL" value={url} onChange={setUrl} placeholder="https://example.com" autoCapitalize="none" keyboardType="url" />
      <Field label="Notes" value={notes} onChange={setNotes} placeholder="Optional" multiline />

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.btnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Entry</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'url' | 'email-address';
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#888"
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        keyboardType={keyboardType ?? 'default'}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, gap: 4, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600', color: '#ccc', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a5e',
    marginBottom: 4,
  },
  inputMultiline: { height: 100, textAlignVertical: 'top' },
  inputRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  inputFlex: { flex: 1, marginBottom: 0 },
  iconBtn: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  iconBtnText: { fontSize: 20 },
  saveBtn: {
    backgroundColor: '#7c83fd',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
