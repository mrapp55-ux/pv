import { useState, useEffect } from 'react';
import { usePwaStore } from './store';
import { setAccessToken, downloadVaultFiles } from './services/drive';
import { keyProvider } from './services/keyDerivation';
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

/** Wait for the GIS library to load (injected async via <script> in index.html). */
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
  const { step, setStep, setVault } = usePwaStore();
  const [saltB64,      setSaltB64]      = useState('');
  const [encryptedB64, setEncryptedB64] = useState('');
  const [error,        setError]        = useState('');
  const [hasCachedVault, setHasCachedVault] = useState(false);

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setSaltB64(cached.saltB64);
      setEncryptedB64(cached.encryptedB64);
      setHasCachedVault(true);
      setStep('password');
      // Attempt silent background sync — no popup, fails gracefully
      silentSync(cached, setSaltB64, setEncryptedB64);
    }
  }, []);

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
        const files = await downloadVaultFiles();
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
        const files = await downloadVaultFiles();
        setSaltB64(files.saltB64);
        setEncryptedB64(files.encryptedB64);
        saveCache(files.saltB64, files.encryptedB64);
      } catch (e) {
        setError(String(e));
      }
    });
  }

  async function handleUnlock(password: string) {
    setError('');
    setStep('unlocking');
    try {
      const masterKey = await keyProvider.deriveKey(password, saltB64);
      const payload   = await decryptSidecar(masterKey, encryptedB64);
      setVault(payload.entries, payload.groups);
      setStep('unlocked');
    } catch {
      setError('Wrong password, or the vault file is corrupt.');
      setStep('password');
    }
  }

  if (step === 'unlocked') return <VaultPage />;

  return (
    <UnlockPage
      step={step}
      error={error}
      hasCachedVault={hasCachedVault}
      onGoogleSignIn={handleGoogleSignIn}
      onSync={handleSync}
      onUnlock={handleUnlock}
    />
  );
}

/**
 * Try to silently refresh vault files from Drive without any user interaction.
 * Uses prompt:'none' — if Google has no active session or the token request
 * requires UI, error_callback fires and we silently fall back to cached files.
 */
async function silentSync(
  cached: { saltB64: string; encryptedB64: string },
  setSaltB64: (s: string) => void,
  setEncryptedB64: (s: string) => void,
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
            const files = await downloadVaultFiles();
            setSaltB64(files.saltB64);
            setEncryptedB64(files.encryptedB64);
            saveCache(files.saltB64, files.encryptedB64);
          } catch {
            // Drive unavailable — cached files remain in state
          }
        }
        resolve();
      },
      error_callback: () => resolve(), // needs interaction — silently skip
    }).requestAccessToken();
  });
}
