/**
 * Vault entry list — the main screen after unlock.
 *
 * Shows title, username, URL for each entry (no passwords decrypted at list level).
 * Tapping an entry navigates to the detail/edit view.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { listEntries } from '../../services/database';
import { useVaultStore } from '../../store/vault';
import type { VaultEntry } from '@vault/shared-types';

type ListEntry = Omit<VaultEntry, 'password' | 'notes'>;

export default function VaultIndex() {
  const router = useRouter();
  const { entries, setEntries } = useVaultStore();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = search.trim()
    ? entries.filter(e =>
        e.title.toLowerCase().includes(search.toLowerCase()) ||
        (e.username ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.url ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setEntries(await listEntries());
    } finally {
      setRefreshing(false);
    }
  }, [setEntries]);

  useEffect(() => {
    void refresh();
  }, []);

  function renderItem({ item }: { item: ListEntry }) {
    const initials = item.title.slice(0, 2).toUpperCase();
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/(vault)/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {item.username && (
            <Text style={styles.cardSub} numberOfLines={1}>{item.username}</Text>
          )}
          {item.url && (
            <Text style={styles.cardUrl} numberOfLines={1}>{item.url}</Text>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search…"
        placeholderTextColor="#888"
        clearButtonMode="while-editing"
      />

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#7c83fd" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔒</Text>
            <Text style={styles.emptyText}>
              {search ? 'No matching entries.' : 'No passwords yet.\nTap + to add one.'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/(vault)/new')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  search: {
    margin: 16,
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#3a3a5e',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7c83fd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cardContent: { flex: 1 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  cardSub: { color: '#aaa', fontSize: 13 },
  cardUrl: { color: '#7c83fd', fontSize: 12, marginTop: 2 },
  chevron: { color: '#555', fontSize: 24, fontWeight: '300' },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyText: { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7c83fd',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c83fd',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
});
