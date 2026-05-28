import { Stack } from 'expo-router';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { lock } from '@vault/shared-crypto';
import { closeDatabase } from '../../services/database';
import { useVaultStore } from '../../store/vault';

export default function VaultLayout() {
  const reset = useVaultStore(s => s.reset);

  function handleLock() {
    lock();
    closeDatabase();
    reset();
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerRight: () => (
          <TouchableOpacity onPress={handleLock} style={styles.lockBtn}>
            <Text style={styles.lockBtnText}>Lock</Text>
          </TouchableOpacity>
        ),
      }}
    />
  );
}

const styles = StyleSheet.create({
  lockBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  lockBtnText: { color: '#7c83fd', fontSize: 15, fontWeight: '600' },
});
