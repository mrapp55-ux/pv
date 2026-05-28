import { useCallback, useEffect, useState } from 'react';
import { listEntries, lockVault, getVaultFolder, relocateVault, detectGoogleDrive, pickVaultFolder, deleteVault } from '../services/tauri-bridge';
import { useVaultStore } from '../store/vault';
import EntryDetailPanel from './EntryDetailPanel';
import NewEntryPanel from './NewEntryPanel';

export default function VaultPage() {
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
          <SettingsPanel onClose={() => setShowSettings(false)} />
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

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { reset, setAuthState } = useVaultStore();
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [moving, setMoving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const folder = await getVaultFolder();
      setCurrentFolder(folder);
      if (folder) setNewFolder(folder);
    })();
  }, []);

  async function handleBrowse() {
    const picked = await pickVaultFolder();
    if (picked) setNewFolder(picked);
  }

  async function handleDetectDrive() {
    const drive = await detectGoogleDrive();
    if (drive) {
      setNewFolder(drive + '/PasswordVault');
      setStatus('Google Drive detected — folder path set.');
    } else {
      setError('Google Drive not found on this machine.');
    }
  }

  async function handleMove() {
    if (!newFolder.trim()) return;
    setMoving(true); setError(''); setStatus('');
    try {
      await relocateVault(newFolder.trim());
      setCurrentFolder(newFolder.trim());
      setStatus('Vault moved successfully. Google Drive will sync it to your other computers.');
    } catch (e) {
      setError(String(e));
    } finally {
      setMoving(false);
    }
  }

  async function handleDeleteVault() {
    if (!window.confirm('Delete the vault permanently?\n\nThis removes vault.db, vault.salt, saved preferences, and the stored biometric key. This cannot be undone.')) return;
    await deleteVault();
    reset();
    setAuthState('setup');
  }

  const isGoogleDrive = newFolder && (newFolder.includes('My Drive') || newFolder.includes('Google Drive'));
  const unchanged = newFolder.trim() === (currentFolder ?? '');

  return (
    <div style={ss.panel}>
      <div style={ss.header}>
        <h2 style={ss.heading}>Settings</h2>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>

      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Vault Storage & Sync</h3>
        <p style={ss.desc}>
          Store your vault in a Google Drive folder so it syncs automatically to all your
          computers. Mobile access uses the Google Drive API. The vault file is always
          encrypted — Google never sees your passwords.
        </p>

        <div style={ss.fieldRow}>
          <span style={ss.fieldLabel}>Current location</span>
          <code style={ss.path}>{currentFolder ?? 'Default (%LOCALAPPDATA%\\PasswordVault)'}</code>
        </div>

        <label style={ss.inputLabel}>New folder</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            value={newFolder}
            onChange={e => setNewFolder(e.target.value)}
            placeholder="%LOCALAPPDATA%\PasswordVault"
            style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          />
          <button className="ghost" onClick={handleBrowse} style={{ whiteSpace: 'nowrap' }}>Browse…</button>
          <button className="ghost" onClick={handleDetectDrive} title="Auto-detect Google Drive" style={{ whiteSpace: 'nowrap' }}>☁ Detect Drive</button>
        </div>

        {isGoogleDrive && (
          <p style={ss.syncNote}>
            ☁ Google Drive folder detected — vault will sync automatically between all computers that have Google Drive installed.
          </p>
        )}

        {error && <p style={ss.error}>{error}</p>}
        {status && <p style={ss.success}>{status}</p>}

        <button
          className="primary"
          onClick={handleMove}
          disabled={moving || unchanged}
          style={{ marginTop: 8 }}
        >
          {moving ? 'Moving vault…' : 'Move Vault Here'}
        </button>
      </section>

      <section style={{ ...ss.section, borderColor: 'var(--danger)' }}>
        <h3 style={{ ...ss.sectionTitle, color: 'var(--danger)' }}>Danger Zone</h3>
        <p style={ss.desc}>
          Permanently deletes vault.db, vault.salt, preferences, and the stored biometric key.
          All passwords will be gone. This cannot be undone.
        </p>
        <button
          onClick={handleDeleteVault}
          style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
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
