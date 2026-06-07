const FID_CRED_KEY    = 'pv_fid_cred';
const FID_WRAPPED_KEY = 'pv_fid_wrapped';

// Fixed PRF eval input — must be consistent across registration and assertion
const PRF_INPUT = new TextEncoder().encode('pv-master-key-v1');

export function isFaceIdSetUp(): boolean {
  return !!(localStorage.getItem(FID_CRED_KEY) && localStorage.getItem(FID_WRAPPED_KEY));
}

export function disableFaceId(): void {
  localStorage.removeItem(FID_CRED_KEY);
  localStorage.removeItem(FID_WRAPPED_KEY);
}

/** Register a new passkey and wrap the master key with its PRF output. */
export async function setupFaceId(masterKey: Uint8Array): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'PV', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode('pv-user'),
        name: 'pv',
        displayName: 'PV Vault',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential;

  const ext = (cred.getClientExtensionResults() as Record<string, unknown> & {
    prf?: { results?: { first?: ArrayBuffer } };
  }).prf;

  if (!ext?.results?.first) {
    throw new Error('Face ID is not supported on this device or browser. Requires iOS 17+ Safari.');
  }

  const prfOutput   = new Uint8Array(ext.results.first);
  const credentialId = toBase64(new Uint8Array(cred.rawId));
  const wrappedKey  = await wrapKey(prfOutput, masterKey);

  localStorage.setItem(FID_CRED_KEY,    credentialId);
  localStorage.setItem(FID_WRAPPED_KEY, wrappedKey);
}

/** Trigger Face ID and return the unwrapped master key. */
export async function unlockWithFaceId(): Promise<Uint8Array> {
  const credentialId = localStorage.getItem(FID_CRED_KEY);
  const wrappedKey   = localStorage.getItem(FID_WRAPPED_KEY);
  if (!credentialId || !wrappedKey) throw new Error('Face ID not set up');

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId     = fromBase64(credentialId);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential;

  const ext = (assertion.getClientExtensionResults() as Record<string, unknown> & {
    prf?: { results?: { first?: ArrayBuffer } };
  }).prf;

  if (!ext?.results?.first) throw new Error('PRF output not returned — Face ID may not be supported.');

  const prfOutput = new Uint8Array(ext.results.first);
  return unwrapKey(prfOutput, wrappedKey);
}

// ── AES-KW helpers ────────────────────────────────────────────────────────────

async function wrapKey(prfOutput: Uint8Array, masterKey: Uint8Array): Promise<string> {
  const wrapping = await crypto.subtle.importKey('raw', prfOutput, 'AES-KW', false, ['wrapKey']);
  const key      = await crypto.subtle.importKey('raw', masterKey, 'AES-GCM', true, ['encrypt']);
  const wrapped  = await crypto.subtle.wrapKey('raw', key, wrapping, 'AES-KW');
  return toBase64(new Uint8Array(wrapped));
}

async function unwrapKey(prfOutput: Uint8Array, wrappedB64: string): Promise<Uint8Array> {
  const wrapped  = fromBase64(wrappedB64);
  const wrapping = await crypto.subtle.importKey('raw', prfOutput, 'AES-KW', false, ['unwrapKey']);
  const key      = await crypto.subtle.unwrapKey('raw', wrapped, wrapping, 'AES-KW', 'AES-GCM', true, ['encrypt']);
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
