import { useEffect } from 'react';
import { isUnlocked, isVaultInitialized } from './services/tauri-bridge';
import { useVaultStore } from './store/vault';
import SetupPage from './pages/SetupPage';
import UnlockPage from './pages/UnlockPage';
import VaultPage from './pages/VaultPage';

export default function App() {
  const { authState, setAuthState } = useVaultStore();

  useEffect(() => {
    void (async () => {
      const initialized = await isVaultInitialized();
      if (!initialized) { setAuthState('setup'); return; }
      const unlocked = await isUnlocked();
      setAuthState(unlocked ? 'unlocked' : 'locked');
    })();
  }, []);

  if (authState === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    );
  }

  if (authState === 'setup') return <SetupPage />;
  if (authState === 'locked') return <UnlockPage />;
  return <VaultPage />;
}
