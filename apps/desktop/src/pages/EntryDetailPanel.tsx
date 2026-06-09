import { useEffect, useRef, useState } from 'react';
import { deleteEntry, getEntry, updateEntry, type EntryDetail, type SecurityQuestion, type Group } from '../services/tauri-bridge';

const CLIPBOARD_CLEAR_MS = 30_000;

export default function EntryDetailPanel({
  id, onUpdated, onDeleted, groups,
}: {
  id: string;
  onUpdated: () => Promise<void>;
  onDeleted: () => void;
  groups: Group[];
}) {
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPw, setShowPw] = useState(true);
  const [showSQView, setShowSQView] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [showSQ, setShowSQ] = useState(false);
  const [securityQuestions, setSecurityQuestions] = useState<SecurityQuestion[]>([]);

  useEffect(() => { void load(); }, [id]);
  useEffect(() => () => { if (clipTimer.current) clearTimeout(clipTimer.current); }, []);

  async function load() {
    setEditing(false); setError('');
    const e = await getEntry(id);
    setEntry(e);
    setTitle(e.title); setUsername(e.username ?? '');
    setPassword(e.password); setUrl(e.url ?? ''); setNotes(e.notes ?? '');
    setGroupId(e.group_id);
    const sqs = e.security_questions ?? [];
    setSecurityQuestions(sqs);
    setShowSQ(sqs.length > 0);
  }

  function copyField(value: string, field: string) {
    navigator.clipboard.writeText(value);
    setCopied(field);
    if (clipTimer.current) clearTimeout(clipTimer.current);
    clipTimer.current = setTimeout(() => {
      navigator.clipboard.writeText('');
      setCopied(null);
    }, CLIPBOARD_CLEAR_MS);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await updateEntry(id, {
        title: title.trim(), username: username.trim() || null,
        password, url: url.trim() || null, notes: notes.trim() || null,
        security_questions: showSQ && securityQuestions.length > 0 ? securityQuestions : null,
        group_id: groupId,
      });
      await onUpdated();
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete "${entry?.title}"?\n\nThis cannot be undone.`)) return;
    await deleteEntry(id);
    onDeleted();
  }

  if (!entry) return <div style={s.loading}>Loading…</div>;

  if (editing) {
    return (
      <div style={s.panel}>
        <h2 style={s.heading}>Edit Entry</h2>
        {error && <p style={s.error}>{error}</p>}
        <F label="Title" value={title} onChange={setTitle} />

        {groups.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <label className="field-label">Group</label>
            <select
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value || null)}
              style={{ fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: '100%', cursor: 'pointer' }}
            >
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        <F label="Username / Email" value={username} onChange={setUsername} autoComplete="username" />
        <F label="Password" value={password} onChange={setPassword} type="password" showToggle />
        <F label="URL" value={url} onChange={setUrl} type="url" />
        <F label="Notes" value={notes} onChange={setNotes} multiline />

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
            <span className="field-label" style={{ margin: 0, display: 'inline' }}>Security Questions</span>
            <input
              type="checkbox"
              checked={showSQ}
              onChange={e => {
                setShowSQ(e.target.checked);
                if (e.target.checked && securityQuestions.length === 0)
                  setSecurityQuestions([{ question: '', answer: '' }]);
              }}
              style={{ width: 'auto', cursor: 'pointer' }}
            />
          </label>
          {showSQ && (
            <SecurityQuestionsEditor questions={securityQuestions} onChange={setSecurityQuestions} />
          )}
        </div>

        <div style={s.actions}>
          <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <h2 style={s.heading}>{entry.title}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="primary" onClick={() => setEditing(true)}>Edit</button>
          <button className="danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {groups.length > 1 && entry.group_id && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Group</span>
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>
            {groups.find(g => g.id === entry.group_id)?.name ?? '—'}
          </div>
        </div>
      )}

      {copied && (
        <div style={s.copiedBanner}>
          {copied} copied — clears in 30s
        </div>
      )}

      <Row label="Username" value={entry.username ?? '—'} onCopy={entry.username ? () => copyField(entry.username!, 'Username') : undefined} copied={copied === 'Username'} />
      <Row
        label="Password"
        value={showPw ? entry.password : '•'.repeat(Math.min(entry.password.length, 20))}
        onCopy={() => copyField(entry.password, 'Password')}
        copied={copied === 'Password'}
        extra={<button className="icon-btn" onClick={() => setShowPw(v => !v)}>{showPw ? '👁' : '🙈'}</button>}
      />
      <Row label="URL" value={entry.url ?? '—'} onCopy={entry.url ? () => copyField(entry.url!, 'URL') : undefined} copied={copied === 'URL'} />
      <div style={s.fieldBlock}>
        <span className="field-label">Notes</span>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: entry.notes ? 'var(--text)' : 'var(--text-dim)', whiteSpace: 'pre-wrap', minHeight: 60, margin: '4px 0 0' }}>
          {entry.notes || 'No notes'}
        </p>
      </div>

      {entry.security_questions && entry.security_questions.length > 0 && (
        <div style={s.fieldBlock}>
          <button
            onClick={() => setShowSQView(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
          >
            <span className="field-label" style={{ margin: 0 }}>Security Questions ({entry.security_questions.length})</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showSQView ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showSQView && entry.security_questions.map((sq, i) => (
            <SecurityQuestionRow
              key={i}
              index={i}
              question={sq.question}
              answer={sq.answer}
              copyField={copyField}
              copied={copied}
            />
          ))}
        </div>
      )}

      <p style={s.meta}>Modified {new Date(entry.modified_at).toLocaleString()}</p>
    </div>
  );
}

function SecurityQuestionRow({ index, question, answer, copyField, copied }: {
  index: number;
  question: string;
  answer: string;
  copyField: (v: string, field: string) => void;
  copied: string | null;
}) {
  const [showAnswer, setShowAnswer] = useState(true);
  const field = `SQ${index + 1}`;
  return (
    <div style={{ marginTop: index === 0 ? 8 : 0, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span style={{ fontWeight: 700, marginRight: 6 }}>Q{index + 1}</span>{question || '—'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
          {showAnswer ? answer : '•'.repeat(Math.min(answer.length, 20))}
        </span>
        <button className="icon-btn" onClick={() => setShowAnswer(v => !v)}>
          {showAnswer ? '👁' : '🙈'}
        </button>
        <button
          className="icon-btn"
          onClick={() => copyField(answer, field)}
          title="Copy answer"
          style={{ color: copied === field ? 'var(--success)' : undefined }}
        >
          {copied === field ? '✓' : '⎘'}
        </button>
      </div>
    </div>
  );
}

function SecurityQuestionsEditor({
  questions, onChange,
}: {
  questions: SecurityQuestion[];
  onChange: (qs: SecurityQuestion[]) => void;
}) {
  const [showAnswers, setShowAnswers] = useState<boolean[]>(() => questions.map(() => true));

  function add() {
    onChange([...questions, { question: '', answer: '' }]);
    setShowAnswers(prev => [...prev, true]);
  }

  function remove(i: number) {
    onChange(questions.filter((_, idx) => idx !== i));
    setShowAnswers(prev => prev.filter((_, idx) => idx !== i));
  }

  function update(i: number, field: keyof SecurityQuestion, value: string) {
    onChange(questions.map((q, idx) => idx === i ? { ...q, [field]: value } : q));
  }

  function toggleShow(i: number) {
    setShowAnswers(prev => prev.map((v, idx) => idx === i ? !v : v));
  }

  return (
    <div style={{ marginTop: 10 }}>
      {questions.map((q, i) => (
        <div key={i} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Q{i + 1}</span>
            <button className="icon-btn" onClick={() => remove(i)} style={{ width: 26, height: 22, color: 'var(--danger)', padding: 0 }}>−</button>
          </div>
          <input
            value={q.question}
            onChange={e => update(i, 'question', e.target.value)}
            placeholder="Security question"
            style={{ marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showAnswers[i] ? 'text' : 'password'}
              value={q.answer}
              onChange={e => update(i, 'answer', e.target.value)}
              placeholder="Answer"
            />
            <button className="icon-btn" onClick={() => toggleShow(i)} style={{ width: 36, flexShrink: 0 }}>
              {showAnswers[i] ? '👁' : '🙈'}
            </button>
          </div>
        </div>
      ))}
      <button className="ghost" onClick={add} style={{ fontSize: 12, padding: '4px 10px' }}>
        + Add Question
      </button>
    </div>
  );
}

function Row({ label, value, onCopy, copied, extra }: {
  label: string; value: string; onCopy?: () => void; copied?: boolean; extra?: React.ReactNode;
}) {
  return (
    <div style={s.fieldBlock}>
      <span className="field-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, fontSize: 14, color: 'var(--text)', wordBreak: 'break-all' }}>{value}</span>
        {extra}
        {onCopy && (
          <button className="icon-btn" onClick={onCopy} title="Copy" style={{ color: copied ? 'var(--success)' : undefined }}>
            {copied ? '✓' : '⎘'}
          </button>
        )}
      </div>
    </div>
  );
}

function F({ label, value, onChange, type, multiline, showToggle, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; multiline?: boolean; showToggle?: boolean; autoComplete?: string;
}) {
  const [show, setShow] = useState(true);
  const inputType = showToggle ? (show ? 'text' : 'password') : (type ?? 'text');
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {multiline
          ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
          : <input type={inputType} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} />}
        {showToggle && (
          <button className="icon-btn" onClick={() => setShow(v => !v)} style={{ width: 36 }}>
            {show ? '👁' : '🙈'}
          </button>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: { padding: 28, maxWidth: 580 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: 700 },
  copiedBanner: { background: 'rgba(46,204,113,0.12)', border: '1px solid var(--success)', borderRadius: 6, color: 'var(--success)', fontSize: 12, padding: '6px 12px', marginBottom: 16 },
  fieldBlock: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10, padding: '10px 14px' },
  actions: { display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' },
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 12 },
  meta: { color: 'var(--text-dim)', fontSize: 11, marginTop: 20 },
};

const sq: Record<string, React.CSSProperties> = {
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 24, flexShrink: 0, textAlign: 'center' },
};
