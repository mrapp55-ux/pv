import { useState, useEffect } from 'react';
import { usePwaStore } from './store';
import { setAccessToken, downloadVaultFiles } from './services/drive';
import { keyProvider } from './services/keyDerivation';
import { decryptSidecar } from './services/crypto';
import UnlockPage from './pages/UnlockPage';
import VaultPage from './pages/VaultPage';

// Minimal type declaration for the Google Identity Services library
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

const CACHE_SALT = 'pv_salt';
const CACHE_ENC = 'pv_enc';

function loadCache(): { saltB64: string; encryptedB64: string } | null {
  const salt = localStorage.getItem(CACHE_SALT);
  const enc = localStorage.getItem(CACHE_ENC);
  return salt && enc ? { saltB64: salt, encryptedB64: enc } : null;
}

function saveCache(saltB64: string, encryptedB64: string) {
  localStorage.setItem(CACHE_SALT, saltB64);
  localStorage.setItem(CACHE_ENC, encryptedB64);
}

export default function App() {
  const { step, setStep, setVault } = usePwaStore();
  const [saltB64, setSaltB64] = useState('');
  const [encryptedB64, setEncryptedB64] = useState('');
  const [error, setError] = useState('');
  const [hasCachedVault, setHasCachedVault] = useState(false);

  // On first load, skip Google sign-in if we have cached vault files
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setSaltB64(cached.saltB64);
      setEncryptedB64(cached.encryptedB64);
      setHasCachedVault(true);
      setStep('password');
    }
  }, []);

  function requestGoogleToken(onSuccess: (token: string) => void) {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) { setError('VITE_GOOGLE_CLIENT_ID is not configured.'); return; }
    if (!window.google) { setError('Google Sign-In library not loaded yet — please wait and try again.'); return; }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (response) => {
        if (!response.access_token) {
          setError('Google sign-in failed or was cancelled.');
          return;
        }
        onSuccess(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
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
      const payload = await decryptSidecar(masterKey, encryptedB64);
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
