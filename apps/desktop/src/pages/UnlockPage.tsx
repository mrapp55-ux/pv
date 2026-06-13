import { useEffect, useState } from 'react';
import { deleteVault, isBiometricAvailable, listEntries, unlockBiometric, unlockVault } from '../services/tauri-bridge';
import { useVaultStore } from '../store/vault';

export default function UnlockPage() {
  const { setAuthState, setEntries, reset } = useVaultStore();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(true);
  const [bioAvail, setBioAvail] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    isBiometricAvailable().then(setBioAvail).catch(() => setBioAvail(false));
  }, []);

  // Auto-attempt biometric on mount when available
  useEffect(() => {
    if (bioAvail) void handleBiometric();
  }, [bioAvail]);

  async function handleBiometric() {
    setError(''); setLoading(true);
    try {
      await unlockBiometric();
      setEntries(await listEntries());
      setAuthState('unlocked');
    } catch {
      setError('Biometric verification failed. Enter your master password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteVault() {
    if (!window.confirm('Delete the vault permanently?\n\nThis removes vault.db, vault.salt, saved preferences, and the stored biometric key. This cannot be undone.')) return;
    await deleteVault();
    reset();
    setAuthState('setup');
  }

  async function handlePassword() {
    if (!password) return;
    setError(''); setLoading(true);
    try {
      await unlockVault(password);
      setEntries(await listEntries());
      setAuthState('unlocked');
    } catch {
      const next = failures + 1;
      setFailures(next);
      setError(next >= 10
        ? 'Too many failed attempts.'
        : `Incorrect password. ${10 - next} attempt(s) remaining.`);
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>🔐</div>
        <h1 style={s.title}>Unlock Vault</h1>

        {bioAvail && (
          <button className="ghost" onClick={handleBiometric} disabled={loading} style={s.bioBtn}>
            <span style={{ fontSize: 28, display: 'block', marginBottom: 6 }}>🪟</span>
            Use Windows Hello
          </button>
        )}

        {bioAvail && (
          <div style={s.divider}>
            <hr style={s.hr} /><span style={s.orText}>or</span><hr style={s.hr} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePassword()}
            placeholder="Master password"
            autoFocus={!bioAvail}
            disabled={loading || failures >= 10}
            style={{ flex: 1, marginBottom: 0 }}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowPw(v => !v)}
            tabIndex={-1}
          >
            {showPw ? '👁' : '🙈'}
          </button>
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button className="primary" onClick={handlePassword} disabled={loading || failures >= 10} style={{ width: '100%', padding: '11px 0' }}>
          {loading ? 'Unlocking…' : 'Unlock'}
        </button>

        <button onClick={handleDeleteVault} style={s.deleteLink}>
          Delete vault…
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' },
  card: { width: 340, padding: 36, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' },
  logo: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  title: { textAlign: 'center', fontSize: 22, fontWeight: 700, marginBottom: 24 },
  bioBtn: { width: '100%', padding: '16px 0', textAlign: 'center', marginBottom: 16 },
  divider: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  hr: { flex: 1, border: 'none', borderTop: '1px solid var(--border)' },
  orText: { color: 'var(--text-muted)', fontSize: 12 },
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 10 },
  deleteLink: { marginTop: 16, width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
};
