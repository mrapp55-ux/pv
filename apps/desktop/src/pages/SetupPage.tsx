import { useEffect, useState } from 'react';
import {
  getVaultLocation,
  generatePassword,
  initializeVault,
  isBiometricAvailable,
  isVaultInitialized,
  listEntries,
  pickVaultFolder,
  setVaultFolder,
  unlockVault,
} from '../services/tauri-bridge';
import { useVaultStore } from '../store/vault';

function entropyBits(pw: string): number {
  let cs = 0;
  if (/[a-z]/.test(pw)) cs += 26;
  if (/[A-Z]/.test(pw)) cs += 26;
  if (/[0-9]/.test(pw)) cs += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) cs += 32;
  return cs > 0 ? Math.log2(cs) * pw.length : 0;
}

export default function SetupPage() {
  const { setAuthState, setEntries } = useVaultStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Vault location state
  const [vaultFolder, setVaultFolderState] = useState('');
  const [driveDetected, setDriveDetected] = useState<string | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const [existingVault, setExistingVault] = useState(false);

  const bits = entropyBits(password);
  const strength = bits < 28 ? 'Weak' : bits < 40 ? 'Fair' : bits < 60 ? 'Strong' : 'Very strong';
  const strengthColor = bits < 28 ? '#e74c3c' : bits < 40 ? '#f39c12' : bits < 60 ? '#2ecc71' : '#27ae60';

  // Auto-detect Google Drive on mount; check if an existing vault is already there
  useEffect(() => {
    void (async () => {
      const loc = await getVaultLocation().catch(() => null);
      if (loc?.google_drive_available && loc.google_drive_folder) {
        setDriveDetected(loc.google_drive_folder);
        setVaultFolderState(loc.google_drive_folder);
        // Point Rust at the Drive folder so isVaultInitialized checks there
        await setVaultFolder(loc.google_drive_folder).catch(() => {});
        const hasVault = await isVaultInitialized().catch(() => false);
        setExistingVault(hasVault);
      }
      setLocationReady(true);
    })();
  }, []);

  async function handleBrowse() {
    const picked = await pickVaultFolder();
    if (picked) {
      setVaultFolderState(picked);
    }
  }

  async function handleJoin() {
    setError('');
    if (!password) { setError('Enter your master password.'); return; }
    setLoading(true);
    try {
      await unlockVault(password);
      setEntries(await listEntries());
      setAuthState('unlocked');
    } catch {
      setError('Incorrect password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (bits < 1) { setError('Password cannot be empty.'); return; }
    setLoading(true);
    try {
      // Persist folder choice before initializing (Rust reads config when creating DB)
      if (vaultFolder.trim()) {
        await setVaultFolder(vaultFolder.trim());
      }
      const bioAvail = await isBiometricAvailable().catch(() => false);
      await initializeVault(password, bioAvail);
      setEntries(await listEntries());
      setAuthState('unlocked');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fillGenerated() {
    const pw = await generatePassword({ length: 24 });
    setPassword(pw); setConfirm(pw); setShowPw(true);
  }

  const isGoogleDriveFolder = vaultFolder && (
    vaultFolder.includes('My Drive') || vaultFolder.includes('Google Drive')
  );

  if (existingVault) {
    return (
      <div style={s.wrap}>
        <div style={s.card}>
          <div style={s.logo}>🔐</div>
          <h1 style={s.title}>Vault Found</h1>
          <p style={s.subtitle}>
            An existing vault was found on Google Drive at{' '}
            <code style={{ fontSize: 11 }}>{driveDetected}</code>.
            Enter your master password to unlock it.
          </p>

          <label style={s.label}>Master Password</label>
          <div style={s.row}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="Master password…"
              autoComplete="current-password"
              autoFocus
            />
            <button className="icon-btn" onClick={() => setShowPw(v => !v)} style={{ marginLeft: 6, width: 36 }}>
              {showPw ? '👁' : '🙈'}
            </button>
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            className="primary"
            onClick={handleJoin}
            disabled={loading}
            style={{ width: '100%', padding: '11px 0', marginTop: 16 }}
          >
            {loading ? 'Unlocking…' : 'Unlock Vault'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>🔐</div>
        <h1 style={s.title}>Create Your Vault</h1>
        <p style={s.subtitle}>
          Your master password encrypts all data locally. It is never stored — if forgotten, data cannot be recovered.
        </p>

        {/* ── Vault Storage Location ───────────────────── */}
        <div style={s.locationBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={s.sectionLabel}>Vault Storage</span>
            {isGoogleDriveFolder && (
              <span style={s.syncBadge}>☁ Google Drive sync</span>
            )}
          </div>

          {driveDetected ? (
            <p style={s.driveNote}>
              Google Drive detected — your vault will sync automatically between all your computers.
            </p>
          ) : (
            <p style={s.driveNote}>
              Google Drive not found on this machine. Vault will be stored locally. You can move it later via Settings.
            </p>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={vaultFolder}
              onChange={e => setVaultFolderState(e.target.value)}
              placeholder="Default: %LOCALAPPDATA%\PasswordVault"
              style={{ fontSize: 12, flex: 1, fontFamily: 'monospace' }}
            />
            <button className="ghost" onClick={handleBrowse} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              Browse…
            </button>
          </div>
        </div>

        {/* ── Password fields ──────────────────────────── */}
        <label style={s.label}>Master Password</label>
        <div style={s.row}>
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter a strong passphrase…"
            autoComplete="new-password"
          />
          <button className="icon-btn" onClick={() => setShowPw(v => !v)} style={{ marginLeft: 6, width: 36 }}>
            {showPw ? '🙈' : '👁'}
          </button>
        </div>

        {password && (
          <div style={{ marginTop: 6, marginBottom: 12 }}>
            <div style={{ ...s.bar, width: `${Math.min((bits / 80) * 100, 100)}%`, background: strengthColor }} />
            <span style={{ fontSize: 11, color: strengthColor }}>{strength} · ~{Math.floor(bits)} bits</span>
          </div>
        )}

        <label style={s.label}>Confirm Password</label>
        <input
          type={showPw ? 'text' : 'password'}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Re-enter passphrase…"
          autoComplete="new-password"
          style={{ marginBottom: 8 }}
        />

        <button
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: '4px 0', marginBottom: 16 }}
          onClick={fillGenerated}
        >
          ⚡ Generate strong password
        </button>

        {error && <p style={s.error}>{error}</p>}

        <button
          className="primary"
          onClick={handleCreate}
          disabled={loading || !locationReady}
          style={{ width: '100%', padding: '11px 0' }}
        >
          {loading ? 'Creating vault…' : 'Create Vault'}
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' },
  card: { width: 420, padding: 36, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' },
  logo: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  title: { textAlign: 'center', fontSize: 22, fontWeight: 700, marginBottom: 8 },
  subtitle: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  syncBadge: { fontSize: 11, background: 'rgba(46,204,113,0.15)', color: 'var(--success)', borderRadius: 4, padding: '1px 6px', border: '1px solid rgba(46,204,113,0.3)' },
  locationBox: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 20 },
  driveNote: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, marginTop: 12 },
  row: { display: 'flex', alignItems: 'center' },
  bar: { height: 4, borderRadius: 2, background: 'var(--accent)', transition: 'width 0.3s, background 0.3s', marginBottom: 4 },
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 12 },
};
