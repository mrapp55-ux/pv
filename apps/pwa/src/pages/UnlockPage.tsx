import { useState } from 'react';
import type { AppStep } from '../store';

export default function UnlockPage({
  step, error, onGoogleSignIn, onUnlock,
}: {
  step: Exclude<AppStep, 'unlocked'>;
  error: string;
  onGoogleSignIn: () => void;
  onUnlock: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const busy = step === 'unlocking';

  return (
    <div style={s.shell}>
      <div style={s.card}>
        <div style={s.logo}>🔐</div>
        <h1 style={s.title}>PV</h1>
        <p style={s.subtitle}>Password Vault</p>

        {error && <p style={s.error}>{error}</p>}

        {step === 'google' && (
          <button style={s.googleBtn} onClick={onGoogleSignIn}>
            <GoogleIcon />
            Sign in with Google
          </button>
        )}

        {(step === 'password' || step === 'unlocking') && (
          <>
            <p style={s.hint}>Enter your master password</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && password && !busy) onUnlock(password); }}
                placeholder="Master password"
                style={s.input}
                disabled={busy}
                autoFocus
                autoComplete="current-password"
              />
              <button style={s.iconBtn} onClick={() => setShowPw(v => !v)} tabIndex={-1}>
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
            <button
              style={{ ...s.primaryBtn, opacity: busy || !password ? 0.55 : 1 }}
              onClick={() => password && !busy && onUnlock(password)}
              disabled={busy || !password}
            >
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg style={{ width: 20, height: 20, marginRight: 10, flexShrink: 0 }} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f0f1a',
    padding: '24px 16px',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    background: '#1a1a2e',
    borderRadius: 24,
    padding: '40px 28px 36px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
  },
  logo: { fontSize: 52, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 30, fontWeight: 700, color: '#fff', textAlign: 'center', margin: 0 },
  subtitle: { fontSize: 14, color: '#6666aa', textAlign: 'center', marginTop: 4, marginBottom: 32 },
  error: {
    background: 'rgba(231,76,60,0.12)',
    border: '1px solid rgba(231,76,60,0.35)',
    borderRadius: 10,
    color: '#e74c3c',
    fontSize: 13,
    padding: '10px 14px',
    marginBottom: 20,
    lineHeight: 1.5,
  },
  hint: { color: '#8888aa', fontSize: 13, textAlign: 'center', marginBottom: 14 },
  input: {
    flex: 1,
    background: '#0f0f1a',
    border: '1px solid #2a2a4a',
    borderRadius: 12,
    color: '#fff',
    fontSize: 16,
    padding: '13px 14px',
    outline: 'none',
  },
  iconBtn: {
    background: '#0f0f1a',
    border: '1px solid #2a2a4a',
    borderRadius: 12,
    color: '#fff',
    fontSize: 18,
    padding: '0 13px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  googleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    border: 'none',
    borderRadius: 12,
    color: '#333',
    fontSize: 15,
    fontWeight: 600,
    padding: '13px 16px',
    cursor: 'pointer',
  },
  primaryBtn: {
    width: '100%',
    background: '#5865f2',
    border: 'none',
    borderRadius: 12,
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    padding: '14px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
};
