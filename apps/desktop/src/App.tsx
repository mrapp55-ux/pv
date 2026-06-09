import { useEffect, useRef } from 'react';
import { getAutoLockSeconds, isUnlocked, isVaultInitialized, lockVault } from './services/tauri-bridge';
import { useVaultStore } from './store/vault';
import SetupPage from './pages/SetupPage';
import UnlockPage from './pages/UnlockPage';
import VaultPage from './pages/VaultPage';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'click', 'scroll'] as const;

export default function App() {
  const { authState, setAuthState, reset } = useVaultStore();
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLockMsRef = useRef<number>(30 * 1000);

  // Load initial vault state
  useEffect(() => {
    void (async () => {
      const initialized = await isVaultInitialized();
      if (!initialized) { setAuthState('setup'); return; }
      const unlocked = await isUnlocked();
      setAuthState(unlocked ? 'unlocked' : 'locked');
    })();
  }, []);

  // Load auto-lock setting once
  useEffect(() => {
    getAutoLockSeconds().then(s => { autoLockMsRef.current = s * 1000; }).catch(() => {});
  }, []);

  // Inactivity auto-lock
  useEffect(() => {
    if (authState !== 'unlocked') {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      return;
    }

    const schedule = () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (autoLockMsRef.current <= 0) return;
      lockTimerRef.current = setTimeout(async () => {
        await lockVault();
        reset();
        setAuthState('locked');
      }, autoLockMsRef.current);
    };

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, schedule, { passive: true }));
    schedule();

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, schedule));
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [authState]);

  if (authState === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    );
  }

  if (authState === 'setup') return <SetupPage />;
  if (authState === 'locked') return <UnlockPage />;
  return <VaultPage onAutoLockChange={s => { autoLockMsRef.current = s * 1000; }} />;
}
