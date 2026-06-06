import { useState } from 'react';
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

export default function App() {
  const { step, setStep, setVault } = usePwaStore();
  const [saltB64, setSaltB64] = useState('');
  const [encryptedB64, setEncryptedB64] = useState('');
  const [error, setError] = useState('');

  async function handleGoogleSignIn() {
    setError('');
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) { setError('VITE_GOOGLE_CLIENT_ID is not configured.'); return; }
    if (!window.google) { setError('Google Sign-In library not loaded yet — please wait and try again.'); return; }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: async (response) => {
        if (!response.access_token) {
          setError('Google sign-in failed or was cancelled.');
          return;
        }
        setAccessToken(response.access_token);
        setStep('password');
        // Pre-fetch vault files while the user types their password
        try {
          const files = await downloadVaultFiles();
          setSaltB64(files.saltB64);
          setEncryptedB64(files.encryptedB64);
        } catch (e) {
          setError(String(e));
          setStep('google');
        }
      },
    });
    tokenClient.requestAccessToken();
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
      onGoogleSignIn={handleGoogleSignIn}
      onUnlock={handleUnlock}
    />
  );
}
