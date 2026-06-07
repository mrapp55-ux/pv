import { useEffect, useRef, useState } from 'react';
import { usePwaStore } from '../store';
import { clearAccessToken } from '../services/drive';
import type { SidecarEntry } from '../types';

const CLIPBOARD_CLEAR_MS = 30_000;

export default function VaultPage({ onLock }: {
  onLock: () => void;
}) {
  const { entries, groups, selectedGroupId, setSelectedGroupId, lock } = usePwaStore();
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<SidecarEntry | null>(null);

  useEffect(() => {
    if (selectedGroupId === null) {
      const muki = groups.find(g => g.name === 'Muki');
      if (muki) setSelectedGroupId(muki.id);
    }
  }, [groups]);

  const filtered = entries
    .filter(e => !selectedGroupId || e.group_id === selectedGroupId)
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        (e.username ?? '').toLowerCase().includes(q) ||
        (e.url ?? '').toLowerCase().includes(q)
      );
    });

  function handleLock() {
    onLock();
    clearAccessToken();
    lock();
  }

  if (selectedEntry) {
    return (
      <EntryDetail
        entry={selectedEntry}
        groupName={groups.find(g => g.id === selectedEntry.group_id)?.name ?? null}
        showGroup={groups.length > 1}
        onBack={() => setSelectedEntry(null)}
      />
    );
  }

  return (
    <div style={s.shell}>
      <div style={s.header}>
        <span style={s.appName}>🔐 PV</span>
        <button style={s.lockBtn} onClick={handleLock} title="Lock vault">🔒</button>
      </div>

      <div style={s.controls}>
        {groups.length > 1 && (
          <select
            value={selectedGroupId ?? ''}
            onChange={e => setSelectedGroupId(e.target.value || null)}
            style={s.groupSelect}
          >
            <option value="">All Groups</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={selectedGroupId ? `Search in ${groups.find(g => g.id === selectedGroupId)?.name ?? ''}…` : 'Search all groups…'}
          style={s.searchInput}
        />
      </div>

      <div style={s.list}>
        {filtered.length === 0 && (
          <p style={s.empty}>{search ? 'No results.' : 'No entries.'}</p>
        )}
        {filtered.map(entry => (
          <button key={entry.id} style={s.row} onClick={() => setSelectedEntry(entry)}>
            <div style={s.avatar}>{entry.title.slice(0, 2).toUpperCase()}</div>
            <div style={s.rowInfo}>
              <div style={s.rowTitle}>{entry.title}</div>
              {entry.username && <div style={s.rowSub}>{entry.username}</div>}
              {entry.url && <div style={s.rowUrl}>{entry.url}</div>}
            </div>
            <span style={{ color: '#444', fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Entry detail ──────────────────────────────────────────────────────────────

function EntryDetail({ entry, groupName, showGroup, onBack }: {
  entry: SidecarEntry;
  groupName: string | null;
  showGroup: boolean;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    if (clipTimer.current) clearTimeout(clipTimer.current);
    clipTimer.current = setTimeout(() => {
      navigator.clipboard.writeText('');
      setCopied(null);
    }, CLIPBOARD_CLEAR_MS);
  }

  return (
    <div style={s.shell}>
      <div style={s.detailHeader}>
        <button style={s.backBtn} onClick={onBack}>‹ Back</button>
        <span style={s.detailTitle}>{entry.title}</span>
      </div>

      {copied && (
        <div style={s.copiedBanner}>{copied} copied — clears in 30s</div>
      )}

      <div style={s.detailBody}>
        {showGroup && groupName && (
          <div style={s.fieldBlock}>
            <span style={s.fieldLabel}>Group</span>
            <span style={s.fieldValue}>{groupName}</span>
          </div>
        )}

        <CopyField label="Username" value={entry.username} copied={copied} onCopy={entry.username ? () => copy(entry.username!, 'Username') : undefined} />
        <PasswordField password={entry.password} copied={copied === 'Password'} onCopy={() => copy(entry.password, 'Password')} />
        <CopyField label="URL" value={entry.url} copied={copied} onCopy={entry.url ? () => copy(entry.url!, 'URL') : undefined} />

        <div style={s.fieldBlock}>
          <span style={s.fieldLabel}>Notes</span>
          <p style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', lineHeight: 1.7, marginTop: 4, minHeight: 80, color: entry.notes ? '#fff' : '#444' }}>
            {entry.notes || 'No notes'}
          </p>
        </div>

        {entry.security_questions && entry.security_questions.length > 0 && (
          <div style={s.fieldBlock}>
            <span style={s.fieldLabel}>Security Questions</span>
            {entry.security_questions.map((sq, i) => (
              <SQRow key={i} index={i} sq={sq} copied={copied} onCopy={() => copy(sq.answer, `SQ${i + 1}`)} label={`SQ${i + 1}`} />
            ))}
          </div>
        )}

        <p style={s.meta}>Modified {new Date(entry.modified_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function SQRow({ index, sq, copied, onCopy, label }: {
  index: number; sq: { question: string; answer: string }; copied: string | null; onCopy: () => void; label: string;
}) {
  const [show, setShow] = useState(true);
  return (
    <div style={{ marginTop: index === 0 ? 8 : 4 }}>
      <div style={{ fontSize: 12, color: '#8888aa', marginBottom: 4 }}>
        <strong>Q{index + 1}</strong> {sq.question}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 14, color: '#fff', fontFamily: 'monospace' }}>
          {show ? sq.answer : '•'.repeat(Math.min(sq.answer.length, 16))}
        </span>
        <button style={s.iconAction} onClick={() => setShow(v => !v)}>{show ? '👁' : '🙈'}</button>
        <button style={{ ...s.iconAction, color: copied === label ? '#2ecc71' : '#8888aa' }} onClick={onCopy}>
          {copied === label ? '✓' : '📋'}
        </button>
      </div>
    </div>
  );
}

function CopyField({ label, value, copied, onCopy }: {
  label: string; value: string | null; copied: string | null; onCopy?: () => void;
}) {
  return (
    <div style={s.fieldBlock}>
      <span style={s.fieldLabel}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...s.fieldValue, flex: 1, wordBreak: 'break-all' }}>{value ?? '—'}</span>
        {onCopy && (
          <button
            style={{ ...s.iconAction, color: copied === label ? '#2ecc71' : '#8888aa' }}
            onClick={onCopy}
          >
            {copied === label ? '✓' : '📋'}
          </button>
        )}
      </div>
    </div>
  );
}

function PasswordField({ password, copied, onCopy }: {
  password: string; copied: boolean; onCopy: () => void;
}) {
  const [show, setShow] = useState(true);
  return (
    <div style={s.fieldBlock}>
      <span style={s.fieldLabel}>Password</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...s.fieldValue, flex: 1, fontFamily: 'monospace' }}>
          {show ? password : '•'.repeat(Math.min(password.length, 20))}
        </span>
        <button style={s.iconAction} onClick={() => setShow(v => !v)}>{show ? '👁' : '🙈'}</button>
        <button style={{ ...s.iconAction, color: copied ? '#2ecc71' : '#8888aa' }} onClick={onCopy}>
          {copied ? '✓' : '📋'}
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: { minHeight: '100dvh', background: '#0f0f1a', color: '#fff', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 16px 8px',
    paddingTop: 'max(16px, env(safe-area-inset-top))',
  },
  appName: { fontSize: 18, fontWeight: 700 },
  lockBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' },
  controls: { padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 },
  groupSelect: {
    background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12,
    color: '#fff', fontSize: 14, padding: '11px 14px', width: '100%',
  },
  searchInput: {
    background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12,
    color: '#fff', fontSize: 15, padding: '11px 14px', width: '100%',
    boxSizing: 'border-box' as const, outline: 'none',
  },
  list: { flex: 1, overflowY: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    padding: '13px 16px', background: 'none', border: 'none',
    borderBottom: '1px solid #15152a', color: '#fff',
    textAlign: 'left', cursor: 'pointer',
  },
  avatar: {
    width: 42, height: 42, borderRadius: 13, background: '#5865f2',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 14, flexShrink: 0,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowSub: { fontSize: 12, color: '#8888aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 },
  rowUrl: { fontSize: 11, color: '#5865f2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
  empty: { textAlign: 'center', color: '#444', padding: 48, fontSize: 14 },
  // Detail
  detailHeader: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 16px',
    paddingTop: 'max(14px, env(safe-area-inset-top))',
    borderBottom: '1px solid #15152a',
  },
  backBtn: { background: 'none', border: 'none', color: '#5865f2', fontSize: 17, cursor: 'pointer', padding: '4px 0', flexShrink: 0 },
  detailTitle: { fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detailBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
  copiedBanner: { background: 'rgba(46,204,113,0.12)', borderBottom: '1px solid rgba(46,204,113,0.25)', color: '#2ecc71', fontSize: 13, padding: '10px 16px', textAlign: 'center' },
  fieldBlock: { background: '#1a1a2e', borderRadius: 14, padding: '12px 14px' },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 5 },
  fieldValue: { fontSize: 15, color: '#fff' },
  iconAction: { background: 'none', border: 'none', fontSize: 30, cursor: 'pointer', padding: '8px 10px', flexShrink: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 11, color: '#444', textAlign: 'center', paddingTop: 8 },
};
