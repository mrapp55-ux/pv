import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { usePwaStore } from './store';
import { setAccessToken, clearAccessToken, downloadVaultFiles, downloadSettings } from './services/drive';

const CACHE_AUTO_LOCK_MS = 'pv_auto_lock_ms';
function loadAutoLockMs(): number {
  const cached = localStorage.getItem(CACHE_AUTO_LOCK_MS);
  return cached !== null ? parseInt(cached, 10) : 30_000;
}
const ACTIVITY_EVENTS = ['touchstart', 'mousedown', 'keydown', 'click', 'scroll'] as const;
import { keyProvider, hasFaceIdEnrolled, enrollFaceId, unlockWithFaceId } from './services/keyDerivation';
import { decryptSidecar } from './services/crypto';
import UnlockPage from './pages/UnlockPage';
import VaultPage from './pages/VaultPage';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (r: { access_token?: string; error?: string }) => void;
            error_callback?: (e: { type: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

const CACHE_SALT = 'pv_salt';
const CACHE_ENC  = 'pv_enc';

function loadCache(): { saltB64: string; encryptedB64: string } | null {
  const salt = localStorage.getItem(CACHE_SALT);
  const enc  = localStorage.getItem(CACHE_ENC);
  return salt && enc ? { saltB64: salt, encryptedB64: enc } : null;
}

function saveCache(saltB64: string, encryptedB64: string) {
  localStorage.setItem(CACHE_SALT, saltB64);
  localStorage.setItem(CACHE_ENC,  encryptedB64);
}

function waitForGoogle(timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.google) { resolve(true); return; }
    const start = Date.now();
    const id = setInterval(() => {
      if (window.google) { clearInterval(id); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(id); resolve(false); }
    }, 100);
  });
}

export default function App() {
  const { step, setStep, setVault, lock } = usePwaStore();
  const lockTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLockMsRef  = useRef(loadAutoLockMs());
  const masterKeyRef   = useRef<Uint8Array | null>(null);
  const [saltB64,        setSaltB64]        = useState('');
  const [encryptedB64,   setEncryptedB64]   = useState('');
  const [error,          setError]          = useState('');
  const [hasCachedVault, setHasCachedVault] = useState(false);
  const [faceIdPromo,    setFaceIdPromo]    = useState(false);

  // 30-second inactivity auto-lock
  useEffect(() => {
    if (step !== 'unlocked') {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      return;
    }
    const schedule = () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      const ms = autoLockMsRef.current;
      if (ms === 0) return;
      lockTimerRef.current = setTimeout(() => {
        clearAccessToken();
        lock();
      }, ms);
    };
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, schedule, { passive: true }));
    schedule();
    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, schedule));
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [step]);

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setSaltB64(cached.saltB64);
      setEncryptedB64(cached.encryptedB64);
      setHasCachedVault(true);
      if (hasFaceIdEnrolled()) {
        void handleFaceIdUnlock(cached.encryptedB64);
      } else {
        setStep('password');
        silentSync(setSaltB64, setEncryptedB64, autoLockMsRef);
      }
    } else if (!navigator.onLine) {
      setError('You\'re offline and no vault cache was found. Open PV while connected to Google at least once to enable offline access.');
    }
  }, []);

  // Zero the cached master key and hide the enrollment promo when the vault locks
  useEffect(() => {
    if (step !== 'unlocked') {
      masterKeyRef.current?.fill(0);
      masterKeyRef.current = null;
      setFaceIdPromo(false);
    }
  }, [step]);

  // ── Google helpers ────────────────────────────────────────────────────────

  function requestGoogleToken(onSuccess: (token: string) => void) {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId)      { setError('VITE_GOOGLE_CLIENT_ID is not configured.'); return; }
    if (!window.google) { setError('Google Sign-In library not loaded yet — please wait and try again.'); return; }
    window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (response) => {
        if (!response.access_token) { setError('Google sign-in failed or was cancelled.'); return; }
        onSuccess(response.access_token);
      },
    }).requestAccessToken();
  }

  async function handleGoogleSignIn() {
    setError('');
    requestGoogleToken(async (token) => {
      setAccessToken(token);
      setStep('password');
      try {
        const [files] = await Promise.all([downloadVaultFiles(), applySettings(autoLockMsRef)]);
        setSaltB64(files.saltB64);
        setEncryptedB64(files.encryptedB64);
        saveCache(files.saltB64, files.encryptedB64);
        setHasCachedVault(true);
      } catch (e) {
        setError(String(e));
        setStep('google');
      }
    });
  }

  async function handleSync() {
    setError('');
    requestGoogleToken(async (token) => {
      setAccessToken(token);
      try {
        const [files] = await Promise.all([downloadVaultFiles(), applySettings(autoLockMsRef)]);
        setSaltB64(files.saltB64);
        setEncryptedB64(files.encryptedB64);
        saveCache(files.saltB64, files.encryptedB64);
      } catch (e) {
        setError(String(e));
      }
    });
  }

  // ── Unlock helpers ────────────────────────────────────────────────────────

  async function handleFaceIdUnlock(enc: string) {
    setError('');
    setStep('unlocking');
    const masterKey = await unlockWithFaceId();
    if (!masterKey) {
      // User cancelled or Face ID failed — fall back to password
      setStep('password');
      silentSync(setSaltB64, setEncryptedB64, autoLockMsRef);
      return;
    }
    try {
      const payload = await decryptSidecar(masterKey, enc);
      masterKeyRef.current = masterKey;
      setVault(payload.entries, payload.groups);
      setStep('unlocked');
      silentSync(setSaltB64, setEncryptedB64, autoLockMsRef);
    } catch {
      setError('Face ID key mismatch — please use your master password.');
      setStep('password');
    }
  }

  async function handleUnlock(password: string) {
    setError('');
    setStep('unlocking');
    try {
      const masterKey = await keyProvider.deriveKey(password, saltB64);
      const payload = await decryptSidecar(masterKey, encryptedB64);
      masterKeyRef.current = masterKey;
      setVault(payload.entries, payload.groups);
      setStep('unlocked');
    } catch {
      setError('Wrong password, or the vault file is corrupt.');
      setStep('password');
      return;
    }
    // Offer Face ID enrollment outside the try/catch so it can't affect the unlock state
    if (!hasFaceIdEnrolled() && typeof PublicKeyCredential !== 'undefined') {
      setFaceIdPromo(true);
    }
  }

  async function handleEnrollFaceId() {
    setFaceIdPromo(false);
    if (!masterKeyRef.current) return;
    const ok = await enrollFaceId(masterKeyRef.current);
    if (!ok) setError('Face ID setup failed or is not supported on this device.');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === 'unlocked') {
    return (
      <>
        <VaultPage onLock={() => {}} />
        {faceIdPromo && (
          <div style={faceIdPromoStyle}>
            <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Enable Face ID?</p>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#aaa' }}>
              Unlock with Face ID next time — no password needed.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={faceIdPromoBtnStyle} onClick={() => void handleEnrollFaceId()}>
                Enable
              </button>
              <button style={faceIdPromoDismissStyle} onClick={() => setFaceIdPromo(false)}>
                Not now
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <UnlockPage
      step={step}
      error={error}
      hasCachedVault={hasCachedVault}
      faceIdEnrolled={hasFaceIdEnrolled()}
      onGoogleSignIn={handleGoogleSignIn}
      onSync={handleSync}
      onUnlock={handleUnlock}
      onFaceId={() => void handleFaceIdUnlock(encryptedB64)}
    />
  );
}

const faceIdPromoStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'calc(100% - 48px)',
  maxWidth: 360,
  background: '#1a1a2e',
  border: '1px solid #2a2a4a',
  borderRadius: 16,
  padding: '20px 20px 18px',
  color: '#fff',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  zIndex: 100,
};
const faceIdPromoBtnStyle: React.CSSProperties = {
  flex: 1,
  background: '#5865f2',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  padding: '11px 0',
  cursor: 'pointer',
};
const faceIdPromoDismissStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: '1px solid #2a2a4a',
  borderRadius: 10,
  color: '#888',
  fontSize: 15,
  padding: '11px 0',
  cursor: 'pointer',
};

async function applySettings(autoLockMsRef: MutableRefObject<number>): Promise<void> {
  const settings = await downloadSettings();
  if (settings && typeof settings.auto_lock_seconds === 'number') {
    const ms = settings.auto_lock_seconds * 1000;
    localStorage.setItem(CACHE_AUTO_LOCK_MS, String(ms));
    autoLockMsRef.current = ms;
  }
}

async function silentSync(
  setSaltB64: (s: string) => void,
  setEncryptedB64: (s: string) => void,
  autoLockMsRef: MutableRefObject<number>,
) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) return;
  const ready = await waitForGoogle();
  if (!ready || !window.google) return;

  await new Promise<void>((resolve) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      prompt: 'none',
      callback: async (response) => {
        if (response.access_token) {
          try {
            setAccessToken(response.access_token);
            const [files] = await Promise.all([downloadVaultFiles(), applySettings(autoLockMsRef)]);
            setSaltB64(files.saltB64);
            setEncryptedB64(files.encryptedB64);
            saveCache(files.saltB64, files.encryptedB64);
          } catch { /* cached files remain */ }
        }
        resolve();
      },
      error_callback: () => resolve(),
    }).requestAccessToken();
  });
}
