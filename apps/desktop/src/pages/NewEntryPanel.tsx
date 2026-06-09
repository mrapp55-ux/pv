import { useState } from 'react';
import { createEntry, generatePassword, type SecurityQuestion, type Group } from '../services/tauri-bridge';

export default function NewEntryPanel({
  onSaved, onCancel, groups, defaultGroupId,
}: {
  onSaved: (id: string) => void;
  onCancel: () => void;
  groups: Group[];
  defaultGroupId: string | null;
}) {
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId ?? (groups[0]?.id ?? null));
  const [showPw, setShowPw] = useState(true);
  const [showSQ, setShowSQ] = useState(false);
  const [securityQuestions, setSecurityQuestions] = useState<SecurityQuestion[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function fillGenerated() {
    const pw = await generatePassword({ length: 20 });
    setPassword(pw); setShowPw(true);
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try {
      const id = await createEntry({
        title: title.trim(),
        username: username.trim() || null,
        password,
        url: url.trim() || null,
        notes: notes.trim() || null,
        security_questions: showSQ && securityQuestions.length > 0 ? securityQuestions : null,
        group_id: groupId,
      });
      onSaved(id);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={s.panel}>
      <h2 style={s.heading}>New Entry</h2>
      {error && <p style={s.error}>{error}</p>}

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

      <F label="Title *" value={title} onChange={setTitle} autoFocus />
      <F label="Username / Email" value={username} onChange={setUsername} autoComplete="username" />

      <div style={{ marginBottom: 14 }}>
        <label className="field-label">Password *</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <button className="icon-btn" onClick={() => setShowPw(v => !v)} style={{ width: 36 }}>
            {showPw ? '👁' : '🙈'}
          </button>
          <button className="icon-btn" onClick={fillGenerated} title="Generate password">⚡</button>
        </div>
      </div>

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
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type, multiline, autoComplete, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; multiline?: boolean; autoComplete?: string; autoFocus?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label">{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
        : <input type={type ?? 'text'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} />
      }
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

const s: Record<string, React.CSSProperties> = {
  panel: { padding: 28, maxWidth: 520 },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 20 },
  actions: { display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' },
  error: { color: 'var(--danger)', fontSize: 13, marginBottom: 12 },
};

const sq: Record<string, React.CSSProperties> = {
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 24, flexShrink: 0, textAlign: 'center' },
};
