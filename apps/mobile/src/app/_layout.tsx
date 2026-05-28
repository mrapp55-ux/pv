import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { preventScreenCapture } from 'expo-screen-capture';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useVaultStore } from '../store/vault';
import { isUnlocked, lock } from '@vault/shared-crypto';
import { closeDatabase } from '../services/database';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../config/googleAuth';

const AUTO_LOCK_MS = 60_000;

let lockTimer: ReturnType<typeof setTimeout> | null = null;

// Configure Google Sign-In once at module load time (before any render)
if (GOOGLE_WEB_CLIENT_ID) {
  GoogleSignin.configure({
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    webClientId: GOOGLE_WEB_CLIENT_ID,
    ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
  });
}

export default function RootLayout() {
  const { authState, setAuthState } = useVaultStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    preventScreenCapture();
  }, []);

  useEffect(() => {
    void checkInitialState();
  }, []);

  useEffect(() => {
    if (authState === 'loading') return;

    const inAuth = segments[0] === '(auth)';

    if (authState === 'setup' && !inAuth) {
      router.replace('/(auth)/setup');
    } else if (authState === 'locked' && !inAuth) {
      router.replace('/(auth)/unlock');
    } else if (authState === 'unlocked' && inAuth) {
      router.replace('/(vault)/');
    }
  }, [authState, segments]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(vault)" />
    </Stack>
  );
}

async function checkInitialState() {
  const { setAuthState, setDeviceId } = useVaultStore.getState();
  try {
    const SecureStore = await import('expo-secure-store');
    const deviceId = await SecureStore.getItemAsync('device_id');

    if (!deviceId) {
      setAuthState('setup');
      return;
    }

    setDeviceId(deviceId);
    setAuthState('locked');
  } catch {
    setAuthState('setup');
  }
}

function handleAppStateChange(nextState: AppStateStatus) {
  if (nextState === 'background' || nextState === 'inactive') {
    lockTimer = setTimeout(performLock, AUTO_LOCK_MS);
  } else if (nextState === 'active') {
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
    if (!isUnlocked() && useVaultStore.getState().authState === 'unlocked') {
      performLock();
    }
  }
}

function performLock() {
  lock();
  closeDatabase();
  useVaultStore.getState().reset();
}
