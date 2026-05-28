/**
 * Entry detail / edit screen.
 *
 * Decrypts password and notes on demand (only when viewing this entry).
 * Password is never shown in the list view.
 */

import { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getEntry, updateEntry, deleteEntry, listEntries } from '../../services/database';
import { copySecure, clearClipboard } from '../../services/clipboard';
import { syncAfterWrite } from '../../services/sync';
import { useVaultStore } from '../../store/vault';
import type { VaultEntry } from '@vault/shared-types';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { deviceId, setEntries } = useVaultStore();

  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    void loadEntry();
  }, [id]);

  useEffect(() => {
    return () => clearClipboard(); // clear clipboard when leaving this screen
  }, []);

  async function loadEntry() {
    setLoading(true);
    try {
      const e = await getEntry(id!);
      if (!e) {
        Alert.alert('Not found', 'This entry no longer exists.');
        router.back();
        return;
      }
      setEntry(e);
      setTitle(e.title);
      setUsername(e.username ?? '');
      setPassword(e.password);
      setUrl(e.url ?? '');
      setNotes(e.notes ?? '');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!entry || !deviceId) return;
    setSaving(true);
    try {
      await updateEntry({
        ...entry,
        title: title.trim(),
        username: username.trim() || null,
        password,
        url: url.trim() || null,
        notes: notes.trim() || null,
        deviceId,
      });
      setEntries(await listEntries());
      syncAfterWrite();
      setEditing(false);
      await loadEntry();
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry || !deviceId) return;
    Alert.alert('Delete Entry', `Delete "${entry.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteEntry(entry.id, deviceId);
          setEntries(await listEntries());
          syncAfterWrite();
          router.back();
        },
      },
    ]);
  }

  function handleCopy(field: string, value: string) {
    copySecure(value, () => setCopiedField(null));
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 30_000);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#7c83fd" size="large" />
      </View>
    );
  }

  if (!entry) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {editing ? (
        <>
          <EditField label="Title" value={title} onChange={setTitle} />
          <EditField label="Username / Email" value={username} onChange={setUsername} autoCapitalize="none" />

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, styles.inputFlex]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowPassword(v => !v)}>
              <Text style={styles.iconBtnText}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <EditField label="URL" value={url} onChange={setUrl} autoCapitalize="none" keyboardType="url" />
          <EditField label="Notes" value={notes} onChange={setNotes} multiline />

          <View style={styles.editActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.entryTitle}>{entry.title}</Text>

          <DetailRow label="Username" value={entry.username ?? '—'} onCopy={entry.username ? () => handleCopy('username', entry.username!) : undefined} copied={copiedField === 'username'} />
          <DetailRow
            label="Password"
            value={showPassword ? entry.password : '••••••••••••'}
            onCopy={() => handleCopy('password', entry.password)}
            onToggle={() => setShowPassword(v => !v)}
            copied={copiedField === 'password'}
            isSecret
          />
          <DetailRow label="URL" value={entry.url ?? '—'} onCopy={entry.url ? () => handleCopy('url', entry.url!) : undefined} copied={copiedField === 'url'} />
          {entry.notes && <DetailRow label="Notes" value={entry.notes} />}

          {copiedField && (
            <Text style={styles.copiedNotice}>
              {copiedField.charAt(0).toUpperCase() + copiedField.slice(1)} copied — clears in 30s
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.meta}>
            Modified {new Date(entry.modifiedAt).toLocaleDateString()}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
  onToggle,
  copied,
  isSecret,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  onToggle?: () => void;
  copied?: boolean;
  isSecret?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueRow}>
        <Text style={styles.detailValue} selectable={false}>{value}</Text>
        {onToggle && (
          <TouchableOpacity onPress={onToggle} style={styles.detailAction}>
            <Text style={styles.detailActionText}>{isSecret ? '👁' : ''}</Text>
          </TouchableOpacity>
        )}
        {onCopy && (
          <TouchableOpacity onPress={onCopy} style={styles.detailAction}>
            <Text style={styles.detailActionText}>{copied ? '✓' : '⎘'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function EditField({
  label,
  value,
  onChange,
  multiline,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'url';
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
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
  content: { padding: 20, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' },
  entryTitle: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 24 },
  detailRow: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  detailLabel: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: 4 },
  detailValueRow: { flexDirection: 'row', alignItems: 'center' },
  detailValue: { flex: 1, fontSize: 16, color: '#fff' },
  detailAction: { padding: 6, marginLeft: 4 },
  detailActionText: { fontSize: 18, color: '#7c83fd' },
  copiedNotice: { color: '#2ecc71', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  editBtn: { flex: 1, backgroundColor: '#7c83fd', borderRadius: 12, padding: 14, alignItems: 'center' },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  deleteBtn: { flex: 1, backgroundColor: '#2a2a3e', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' },
  deleteBtnText: { color: '#e74c3c', fontWeight: '700', fontSize: 16 },
  meta: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20 },
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
  editActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, backgroundColor: '#2a2a3e', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3a3a5e' },
  cancelBtnText: { color: '#aaa', fontWeight: '600', fontSize: 16 },
  saveBtn: { flex: 1, backgroundColor: '#7c83fd', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
