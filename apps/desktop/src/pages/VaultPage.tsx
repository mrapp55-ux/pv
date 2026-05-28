import { useCallback, useEffect, useState } from 'react';
import { listEntries, lockVault, getVaultLocation, setUseGoogleDrive, setVaultFolder, relocateVault, pickVaultFolder, deleteVault, getAutoLockMinutes, setAutoLockMinutes, changeMasterPassword, type VaultLocationInfo } from '../services/tauri-bridge';
import { useVaultStore } from '../store/vault';
import EntryDetailPanel from './EntryDetailPanel';
import NewEntryPanel from './NewEntryPanel';

export default function VaultPage({ onAutoLockChange }: { onAutoLockChange: (minutes: number) => void }) {
  const { entries, setEntries, setAuthState, reset, selectedId, setSelectedId } = useVaultStore();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await listEntries());
  }, [setEntries]);

  useEffect(() => { void refresh(); }, []);

  const filtered = search.trim()
    ? entries.filter(e =>
        e.title.toLowerCase().includes(search.toLowerCase()) ||
        (e.username ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.url ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  async function handleLock() {
    await lockVault();
    reset();
    setAuthState('locked');
  }

  function handleEntryDeleted() {
    setSelectedId(null);
    void refresh();
  }

  function openPanel(type: 'entry' | 'new' | 'settings', id?: string) {
    setShowNew(type === 'new');
    setShowSettings(type === 'settings');
    setSelectedId(type === 'entry' && id ? id : null);
  }

  return (
    <div style={s.shell}>
      {/* ── Sidebar ─────────────────────────────── */}
      <aside style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <span style={s.appName}>🔐 Password Vault</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="icon-btn" title="Settings" onClick={() => openPanel('settings')}>⚙</button>
            <button className="icon-btn" title="Lock vault" onClick={handleLock}>🔒</button>
          </div>
        </div>

        <div style={{ padding: '8px 12px 0' }}>
          <button
            className="primary"
            style={{ width: '100%' }}
            onClick={() => openPanel('new')}
          >
            + New Entry
          </button>
        </div>

        <div style={{ padding: '8px 12px 10px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ fontSize: 13 }}
          />
        </div>

        <div style={s.entryList}>
          {filtered.length === 0 && (
            <div style={s.empty}>
              {search ? 'No results.' : 'No entries yet.'}
            </div>
          )}
          {filtered.map(entry => (
            <button
              key={entry.id}
              style={{
                ...s.entryRow,
                background: selectedId === entry.id ? 'var(--accent-dim)' : 'transparent',
                borderLeft: selectedId === entry.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}
              onClick={() => openPanel('entry', entry.id)}
            >
              <div style={s.entryAvatar}>{entry.title.slice(0, 2).toUpperCase()}</div>
              <div style={s.entryInfo}>
                <div style={s.entryTitle}>{entry.title}</div>
                {entry.username && <div style={s.entrySub}>{entry.username}</div>}
                {entry.url && <div style={s.entryUrl}>{entry.url}</div>}
              </div>
            </button>
          ))}
        </div>

      </aside>

      {/* ── Main panel ──────────────────────────── */}
      <main style={s.main}>
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} onAutoLockChange={onAutoLockChange} />
        ) : showNew ? (
          <NewEntryPanel
            onSaved={async (id) => { await refresh(); setSelectedId(id); setShowNew(false); }}
            onCancel={() => setShowNew(false)}
          />
        ) : selectedId ? (
          <EntryDetailPanel
            key={selectedId}
            id={selectedId}
            onUpdated={refresh}
            onDeleted={handleEntryDeleted}
          />
        ) : (
          <div style={s.placeholder}>
            <span style={{ fontSize: 56 }}>🔐</span>
            <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Select an entry or create a new one.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Settings panel ───────────────────────────────────────────────────────────

const AUTO_LOCK_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '1 minute', value: 1 },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
];

function entropyBits(pw: string): number {
  let cs = 0;
  if (/[a-z]/.test(pw)) cs += 26;
  if (/[A-Z]/.test(pw)) cs += 26;
  if (/[0-9]/.test(pw)) cs += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) cs += 32;
  return cs > 0 ? Math.log2(cs) * pw.length : 0;
}

function SettingsPanel({ onClose, onAutoLockChange }: { onClose: () => void; onAutoLockChange: (m: number) => void }) {
  const { reset, setAuthState } = useVaultStore();

  // Storage state
  const [location, setLocation] = useState<VaultLocationInfo | null>(null);
  const [useGD, setUseGD] = useState(false);
  const [customFolder, setCustomFolder] = useState('');
  const [moving, setMoving] = useState(false);
  const [storageStatus, setStorageStatus] = useState('');
  const [storageError, setStorageError] = useState('');

  // Auto-lock state
  const [autoLock, setAutoLock] = useState(5);

  // Change password state
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwStatus, setPwStatus] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    void (async () => {
      const [loc, minutes] = await Promise.all([getVaultLocation(), getAutoLockMinutes()]);
      setLocation(loc);
      setUseGD(loc.use_google_drive);
      if (!loc.use_google_drive) setCustomFolder(loc.resolved_folder);
      setAutoLock(minutes);
    })();
  }, []);

  // ── Storage handlers ──────────────────────────────────────────────────────

  async function handleApplyStorage() {
    setMoving(true); setStorageError(''); setStorageStatus('');
    try {
      if (useGD) {
        if (!location?.google_drive_available) {
          setStorageError('Google Drive not found on this machine.'); return;
        }
        // Move vault to GDrive folder, then set the flag
        await relocateVault(location!.google_drive_folder!);
        await setUseGoogleDrive(true);
        setStorageStatus('Vault is now on Google Drive — syncs automatically across computers.');
      } else {
        if (!customFolder.trim()) { setStorageError('Please enter a folder path.'); return; }
        await relocateVault(customFolder.trim());
        await setVaultFolder(customFolder.trim());
        setStorageStatus('Vault moved to local folder.');
      }
      const loc = await getVaultLocation();
      setLocation(loc);
    } catch (e) {
      setStorageError(String(e));
    } finally {
      setMoving(false);
    }
  }

  async function handleBrowse() {
    const picked = await pickVaultFolder();
    if (picked) setCustomFolder(picked);
  }

  const storageUnchanged = location
    ? useGD === location.use_google_drive && (useGD || customFolder === location.resolved_folder)
    : true;

  // ── Auto-lock handler ─────────────────────────────────────────────────────

  async function handleAutoLockChange(minutes: number) {
    setAutoLock(minutes);
    await setAutoLockMinutes(minutes);
    onAutoLockChange(minutes);
  }

  // ── Change password handler ───────────────────────────────────────────────

  async function handleChangePassword() {
    setPwError(''); setPwStatus('');
    if (!oldPw) { setPwError('Enter your current password.'); return; }
    if (!newPw) { setPwError('Enter a new password.'); return; }
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    setChangingPw(true);
    try {
      await changeMasterPassword(oldPw, newPw);
      setPwStatus('Password changed successfully.');
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (e) {
      setPwError(String(e).includes('WrongPassword') ? 'Current password is incorrect.' : String(e));
    } finally {
      setChangingPw(false);
    }
  }

  // ── Danger zone ───────────────────────────────────────────────────────────

  async function handleDeleteVault() {
    if (!window.confirm('Delete the vault permanently?\n\nThis removes vault.db, vault.salt, saved preferences, and the stored biometric key. This cannot be undone.')) return;
    await deleteVault();
    reset();
    setAuthState('setup');
  }

  const bits = entropyBits(newPw);
  const strengthColor = bits < 28 ? '#e74c3c' : bits < 40 ? '#f39c12' : bits < 60 ? '#2ecc71' : '#27ae60';

  return (
    <div style={ss.panel}>
      <div style={ss.header}>
        <h2 style={ss.heading}>Settings</h2>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>

      {/* ── Vault Storage ──────────────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Vault Storage</h3>
        <p style={ss.desc}>
          The vault file is always encrypted — Google never sees your passwords.
          Google Drive mode auto-detects the drive letter so it works even if it changes.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={useGD} onChange={() => setUseGD(true)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>☁ Google Drive (auto-detect drive letter)</span>
          </label>
          {useGD && location && (
            <div style={{ marginLeft: 24 }}>
              {location.google_drive_available
                ? <code style={ss.path}>{location.google_drive_folder}</code>
                : <p style={ss.error}>Google Drive not found on this machine.</p>}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={!useGD} onChange={() => setUseGD(false)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>📁 Local / custom folder</span>
          </label>
          {!useGD && (
            <div style={{ marginLeft: 24, display: 'flex', gap: 6 }}>
              <input
                value={customFolder}
                onChange={e => setCustomFolder(e.target.value)}
                placeholder="%LOCALAPPDATA%\PasswordVault"
                style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
              />
              <button className="ghost" onClick={handleBrowse} style={{ whiteSpace: 'nowrap' }}>Browse…</button>
            </div>
          )}
        </div>

        {location && (
          <div style={ss.fieldRow}>
            <span style={ss.fieldLabel}>Current location</span>
            <code style={ss.path}>{location.resolved_folder}</code>
          </div>
        )}

        {storageError && <p style={ss.error}>{storageError}</p>}
        {storageStatus && <p style={ss.success}>{storageStatus}</p>}

        <button className="primary" onClick={handleApplyStorage} disabled={moving || storageUnchanged} style={{ marginTop: 8 }}>
          {moving ? 'Moving vault…' : 'Apply & Move Vault'}
        </button>
      </section>

      {/* ── Auto-Lock ─────────────────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Auto-Lock</h3>
        <p style={ss.desc}>Automatically lock the vault after a period of inactivity.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Lock after</span>
          <select
            value={autoLock}
            onChange={e => handleAutoLockChange(Number(e.target.value))}
            style={{ fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
          >
            {AUTO_LOCK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>of inactivity</span>
        </div>
      </section>

      {/* ── Change Master Password ─────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Change Master Password</h3>
        <p style={ss.desc}>All entries are re-encrypted with the new password. This cannot be undone.</p>

        <label style={ss.inputLabel}>Current password</label>
        <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} style={{ marginBottom: 10 }} autoComplete="current-password" />

        <label style={ss.inputLabel}>New password</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
          <button className="icon-btn" onClick={() => setShowNewPw(v => !v)} style={{ width: 36 }}>{showNewPw ? '🙈' : '👁'}</button>
        </div>
        {newPw && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ height: 4, borderRadius: 2, background: strengthColor, width: `${Math.min((bits / 80) * 100, 100)}%`, transition: 'width 0.3s' }} />
            <span style={{ fontSize: 11, color: strengthColor }}>{bits < 28 ? 'Weak' : bits < 40 ? 'Fair' : bits < 60 ? 'Strong' : 'Very strong'} · ~{Math.floor(bits)} bits</span>
          </div>
        )}

        <label style={ss.inputLabel}>Confirm new password</label>
        <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} style={{ marginBottom: 10 }} autoComplete="new-password" />

        {pwError && <p style={ss.error}>{pwError}</p>}
        {pwStatus && <p style={ss.success}>{pwStatus}</p>}

        <button className="primary" onClick={handleChangePassword} disabled={changingPw || !oldPw || !newPw || !confirmPw}>
          {changingPw ? 'Changing password…' : 'Change Password'}
        </button>
      </section>

      {/* ── Danger Zone ───────────────────────────────────────────────── */}
      <section style={{ ...ss.section, borderColor: 'var(--danger)' }}>
        <h3 style={{ ...ss.sectionTitle, color: 'var(--danger)' }}>Danger Zone</h3>
        <p style={ss.desc}>Permanently deletes vault.db, vault.salt, preferences, and the stored biometric key. This cannot be undone.</p>
        <button onClick={handleDeleteVault} style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>
          Delete Vault…
        </button>
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100vh', background: 'var(--bg)' },
  sidebar: { width: 260, minWidth: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' },
  sidebarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 12px 10px', borderBottom: '1px solid var(--border)' },
  appName: { fontWeight: 700, fontSize: 15 },
  entryList: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  entryRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', cursor: 'pointer', border: 'none', textAlign: 'left', color: 'var(--text)', transition: 'background 0.12s' },
  entryAvatar: { width: 34, height: 34, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  entryInfo: { minWidth: 0, flex: 1 },
  entryTitle: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  entrySub: { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  entryUrl: { fontSize: 10, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  main: { flex: 1, overflowY: 'auto' },
  placeholder: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 13 },
};

const ss: Record<string, React.CSSProperties> = {
  panel: { padding: 28, maxWidth: 580 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  heading: { fontSize: 20, fontWeight: 700 },
  section: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10 },
  desc: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 },
  fieldRow: { marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 4 },
  path: { fontSize: 12, background: 'var(--bg)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', display: 'block', wordBreak: 'break-all' as const },
  inputLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 },
  syncNote: { fontSize: 12, color: 'var(--success)', background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, padding: '8px 12px', marginBottom: 8 },
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 8 },
  success: { color: 'var(--success)', fontSize: 13, marginBottom: 8 },
};
