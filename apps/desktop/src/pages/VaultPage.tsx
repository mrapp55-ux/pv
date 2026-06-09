import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  listEntries, listGroups, lockVault,
  getVaultLocation, setUseGoogleDrive, setVaultFolder, relocateVault, pickVaultFolder,
  deleteVault, getAutoLockSeconds, setAutoLockSeconds, changeMasterPassword,
  createEntry, createGroup, renameGroup,
  getEntry, writeFile, saveFileDialog, backupVault,
  type VaultLocationInfo, type Group,
} from '../services/tauri-bridge';
import { useVaultStore } from '../store/vault';
import EntryDetailPanel from './EntryDetailPanel';
import NewEntryPanel from './NewEntryPanel';

export default function VaultPage({ onAutoLockChange }: { onAutoLockChange: (minutes: number) => void }) {
  const { entries, setEntries, groups, setGroups, setAuthState, reset, selectedId, setSelectedId, selectedGroupId, setSelectedGroupId } = useVaultStore();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    const [e, g] = await Promise.all([listEntries(), listGroups()]);
    setEntries(e);
    setGroups(g);
  }, [setEntries, setGroups]);

  useEffect(() => {
    void (async () => {
      const [e, g] = await Promise.all([listEntries(), listGroups()]);
      setEntries(e);
      setGroups(g);
      const muki = g.find(gr => gr.name === 'Muki');
      if (muki) setSelectedGroupId(muki.id);
    })();
  }, []);

  // Filter entries by selected group then by search term
  const filtered = entries
    .filter(e => selectedGroupId === null || e.group_id === selectedGroupId)
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        (e.username ?? '').toLowerCase().includes(q) ||
        (e.url ?? '').toLowerCase().includes(q)
      );
    });

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

      {/* ── Group panel ─────────────────────────────── */}
      <aside style={s.groupPanel}>
        <div style={s.groupHeader}>
          <span style={s.appName}>PV</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="icon-btn" title="Settings" onClick={() => openPanel('settings')}>⚙</button>
            <button className="icon-btn" title="Lock vault" onClick={handleLock}>🔒</button>
          </div>
        </div>

        <div style={s.groupList}>
          <button
            style={{
              ...s.groupRow,
              background: selectedGroupId === null ? 'var(--accent-dim)' : 'transparent',
              borderLeft: selectedGroupId === null ? '2px solid var(--accent)' : '2px solid transparent',
              fontWeight: selectedGroupId === null ? 700 : 500,
            }}
            onClick={() => setSelectedGroupId(null)}
          >
            All Groups
          </button>
          {groups.map(g => (
            <button
              key={g.id}
              style={{
                ...s.groupRow,
                background: selectedGroupId === g.id ? 'var(--accent-dim)' : 'transparent',
                borderLeft: selectedGroupId === g.id ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: selectedGroupId === g.id ? 700 : 500,
              }}
              onClick={() => setSelectedGroupId(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Entry list panel ─────────────────────────── */}
      <aside style={s.entryPanel}>
        <div style={{ padding: '10px 10px 6px' }}>
          <button className="primary" style={{ width: '100%' }} onClick={() => openPanel('new')}>
            + New Entry
          </button>
        </div>

        <div style={{ padding: '0 10px 8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={selectedGroupId ? `Search in ${groups.find(g => g.id === selectedGroupId)?.name ?? ''}…` : 'Search all groups…'}
              style={{ fontSize: 13, paddingRight: search ? 28 : undefined, width: '100%', boxSizing: 'border-box' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
              >
                ✕
              </button>
            )}
          </div>
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

      {/* ── Detail / settings panel ──────────────────── */}
      <main style={s.main}>
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} onAutoLockChange={onAutoLockChange} groups={groups} onGroupsChanged={refresh} />
        ) : showNew ? (
          <NewEntryPanel
            groups={groups}
            defaultGroupId={selectedGroupId}
            onSaved={async (id) => { await refresh(); setSelectedId(id); setShowNew(false); }}
            onCancel={() => setShowNew(false)}
          />
        ) : selectedId ? (
          <EntryDetailPanel
            key={selectedId}
            id={selectedId}
            groups={groups}
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
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
];

function entropyBits(pw: string): number {
  let cs = 0;
  if (/[a-z]/.test(pw)) cs += 26;
  if (/[A-Z]/.test(pw)) cs += 26;
  if (/[0-9]/.test(pw)) cs += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) cs += 32;
  return cs > 0 ? Math.log2(cs) * pw.length : 0;
}

function SettingsPanel({
  onClose, onAutoLockChange, groups, onGroupsChanged,
}: {
  onClose: () => void;
  onAutoLockChange: (m: number) => void;
  groups: Group[];
  onGroupsChanged: () => Promise<void>;
}) {
  const { reset, setAuthState } = useVaultStore();

  // Storage state
  const [location, setLocation] = useState<VaultLocationInfo | null>(null);
  const [useGD, setUseGD] = useState(false);
  const [customFolder, setCustomFolder] = useState('');
  const [moving, setMoving] = useState(false);
  const [storageStatus, setStorageStatus] = useState('');
  const [storageError, setStorageError] = useState('');

  // Auto-lock state
  const [autoLock, setAutoLock] = useState(30);

  // Change password state
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwStatus, setPwStatus] = useState('');
  const [pwError, setPwError] = useState('');

  // Groups state
  const [newGroupName, setNewGroupName] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Export & Backup state
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupErr, setBackupErr] = useState('');


  useEffect(() => {
    void (async () => {
      const [loc, minutes] = await Promise.all([getVaultLocation(), getAutoLockSeconds()]);
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

  async function handleAutoLockChange(seconds: number) {
    setAutoLock(seconds);
    await setAutoLockSeconds(seconds);
    onAutoLockChange(seconds);
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

  // ── Group handlers ────────────────────────────────────────────────────────

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) { setGroupError('Group name is required.'); return; }
    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      setGroupError('A group with that name already exists.'); return;
    }
    setAddingGroup(true); setGroupError('');
    try {
      await createGroup(name);
      setNewGroupName('');
      await onGroupsChanged();
    } catch (e) {
      setGroupError(String(e));
    } finally {
      setAddingGroup(false);
    }
  }

  async function handleRename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    if (groups.some(g => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) {
      setGroupError('A group with that name already exists.'); return;
    }
    setGroupError('');
    try {
      await renameGroup(id, name);
      setRenamingId(null);
      setRenameValue('');
      await onGroupsChanged();
    } catch (e) {
      setGroupError(String(e));
    }
  }

  function startRename(g: Group) {
    setRenamingId(g.id);
    setRenameValue(g.name);
    setGroupError('');
  }

  // ── Import handler ────────────────────────────────────────────────────────

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError(''); setImportStatus(''); setImportProgress(0);
    setImporting(true);
    try {
      const text = await file.text();
      const rows: Array<{ title: string; username?: string | null; password?: string | null; url?: string | null; notes?: string | null; group?: string | null }> = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error('JSON must be an array of entries.');
      setImportTotal(rows.length);

      // Build a set of existing title+group_id combos for duplicate detection
      const existing = await listEntries();
      const existingKeys = new Set(existing.map(ex => `${ex.title.toLowerCase()}|${ex.group_id ?? ''}`));

      // Collect unique group names and resolve/create group IDs
      const groupCache = new Map<string, string>();
      for (const g of groups) groupCache.set(g.name, g.id);

      async function resolveGroup(name: string | null | undefined): Promise<string | null> {
        if (!name) return null;
        if (groupCache.has(name)) return groupCache.get(name)!;
        const id = await createGroup(name);
        groupCache.set(name, id);
        return id;
      }

      const skipped: string[] = [];
      let imported = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const groupId = await resolveGroup(r.group);
        const key = `${(r.title ?? '').toLowerCase()}|${groupId ?? ''}`;
        if (existingKeys.has(key)) {
          skipped.push(r.title ?? `Row ${i + 1}`);
          setImportProgress(i + 1);
          continue;
        }
        await createEntry({
          title: r.title ?? '',
          username: r.username ?? null,
          password: r.password ?? '',
          url: r.url ?? null,
          notes: r.notes ?? null,
          security_questions: null,
          group_id: groupId,
        });
        existingKeys.add(key);
        imported++;
        setImportProgress(i + 1);
      }

      const parts = [`✓ ${imported} entries imported.`];
      if (skipped.length > 0) parts.push(`Skipped ${skipped.length} duplicate${skipped.length > 1 ? 's' : ''}: ${skipped.join(', ')}.`);
      setImportStatus(parts.join(' '));
    } catch (e) {
      setImportError(String(e));
    } finally {
      await onGroupsChanged();
      setImporting(false);
    }
  }

  // ── Export handler ────────────────────────────────────────────────────────

  async function handleExport() {
    setExportErr(''); setExportMsg('');
    if (!window.confirm('The exported file will contain all passwords in plain text.\n\nContinue?')) return;
    const path = await saveFileDialog({
      defaultPath: 'vault_export.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (!path) return;
    setExporting(true);
    try {
      const list = await listEntries();
      const details = await Promise.all(list.map(e => getEntry(e.id)));
      const groupMap = new Map(groups.map(g => [g.id, g.name]));
      const rows = details.map(d => ({
        Group: d.group_id ? (groupMap.get(d.group_id) ?? '') : '',
        Title: d.title,
        Username: d.username ?? '',
        Password: d.password,
        URL: d.url ?? '',
        Notes: d.notes ?? '',
        'Security Questions': d.security_questions
          ? d.security_questions.map(sq => `Q: ${sq.question} / A: ${sq.answer}`).join('\n')
          : '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vault');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      await writeFile(path, Array.from(new Uint8Array(buf)));
      setExportMsg('Export saved.');
    } catch (e) {
      setExportErr(String(e));
    } finally {
      setExporting(false);
    }
  }

  // ── Backup handler ────────────────────────────────────────────────────────

  async function handleBackup() {
    setBackupErr(''); setBackupMsg('');
    const folder = await pickVaultFolder();
    if (!folder) return;
    setBackingUp(true);
    try {
      const stem = await backupVault(folder);
      setBackupMsg(`Backup saved: ${stem}.db`);
    } catch (e) {
      setBackupErr(String(e));
    } finally {
      setBackingUp(false);
    }
  }

  // ── Danger zone ───────────────────────────────────────────────────────────

  async function handleDeleteVault() {
    if (!window.confirm('Are you sure you want to delete the vault?\n\nThis is an irreversible operation — it permanently removes vault.db, vault.salt, saved preferences, and the stored biometric key.\n\nAll your passwords will be lost.')) return;
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

      {/* ── Groups ────────────────────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Groups</h3>
        <p style={ss.desc}>Organise your entries into groups. Each entry belongs to one group.</p>

        <div style={{ marginBottom: 12 }}>
          {groups.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {renamingId === g.id ? (
                <>
                  <input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleRename(g.id); if (e.key === 'Escape') setRenamingId(null); }}
                    style={{ flex: 1, fontSize: 13 }}
                    autoFocus
                  />
                  <button className="primary" onClick={() => handleRename(g.id)} style={{ padding: '4px 10px', fontSize: 12 }}>Save</button>
                  <button className="ghost" onClick={() => setRenamingId(null)} style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13 }}>{g.name}</span>
                  <button className="ghost" onClick={() => startRename(g)} style={{ padding: '3px 10px', fontSize: 12 }}>Rename</button>
                </>
              )}
            </div>
          ))}
        </div>

        {groupError && <p style={ss.error}>{groupError}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleAddGroup(); }}
            placeholder="New group name…"
            style={{ flex: 1, fontSize: 13 }}
          />
          <button className="primary" onClick={handleAddGroup} disabled={addingGroup || !newGroupName.trim()} style={{ whiteSpace: 'nowrap' }}>
            {addingGroup ? 'Adding…' : '+ Add Group'}
          </button>
        </div>
      </section>

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
                placeholder="%LOCALAPPDATA%\PV"
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

      {/* ── Import ────────────────────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Import Entries</h3>
        <p style={ss.desc}>
          Import from a JSON file. Each entry: <code style={{ fontSize: 11 }}>{'{"title","username","password","url","notes","group"}'}</code>.
          The <code style={{ fontSize: 11 }}>group</code> field is optional and will be created if it doesn't exist.
        </p>
        {importError && <p style={ss.error}>{importError}</p>}
        {importStatus && <p style={importStatus.startsWith('✓ 0') ? ss.warning : ss.success}>{importStatus}</p>}
        {importing && <p style={ss.desc}>Importing… {importProgress} / {importTotal}</p>}
        <label className="primary" style={{ display: 'inline-block', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: importing ? 0.55 : 1, pointerEvents: importing ? 'none' : 'auto' }}>
          {importing ? 'Importing…' : 'Choose JSON file…'}
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} disabled={importing} />
        </label>
      </section>

      {/* ── Export & Backup ───────────────────────────────────────────── */}
      <section style={ss.section}>
        <h3 style={ss.sectionTitle}>Export & Backup</h3>
        <p style={ss.desc}>
          Export all entries to an unencrypted Excel file, or create a copy of the
          encrypted vault files for safekeeping.
        </p>
        {exportErr && <p style={ss.error}>{exportErr}</p>}
        {exportMsg && <p style={ss.success}>{exportMsg}</p>}
        <button className="primary" onClick={handleExport} disabled={exporting} style={{ marginBottom: 10 }}>
          {exporting ? 'Exporting…' : 'Export to Excel…'}
        </button>
        {backupErr && <p style={ss.error}>{backupErr}</p>}
        {backupMsg && <p style={ss.success}>{backupMsg}</p>}
        <button className="ghost" onClick={handleBackup} disabled={backingUp} style={{ display: 'block' }}>
          {backingUp ? 'Backing up…' : 'Backup Vault…'}
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
  // Left panel: group navigation
  groupPanel: { width: 160, minWidth: 140, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' },
  groupHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 10px 10px', borderBottom: '1px solid var(--border)' },
  appName: { fontWeight: 700, fontSize: 15 },
  groupList: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  groupRow: { display: 'block', width: '100%', padding: '8px 12px', cursor: 'pointer', border: 'none', textAlign: 'left', fontSize: 13, color: 'var(--text)', background: 'transparent', transition: 'background 0.12s' },
  // Middle panel: entry list
  entryPanel: { width: 240, minWidth: 200, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' },
  entryList: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  entryRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', cursor: 'pointer', border: 'none', textAlign: 'left', color: 'var(--text)', transition: 'background 0.12s' },
  entryAvatar: { width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  entryInfo: { minWidth: 0, flex: 1 },
  entryTitle: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  entrySub: { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  entryUrl: { fontSize: 10, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Right panel: detail / settings
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
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 8 },
  success: { color: 'var(--success)', fontSize: 13, marginBottom: 8 },
  warning: { color: '#f39c12', fontSize: 13, marginBottom: 8 },
};
