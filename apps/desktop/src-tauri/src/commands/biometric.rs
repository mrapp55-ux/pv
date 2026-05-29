/// Biometric / OS keychain integration.
///
/// The 32-byte vault key is stored in the OS keychain (Windows Credential Manager
/// on Windows, Keychain on macOS, libsecret on Linux) via the `keyring` crate.
/// On Windows, the stored credential is DPAPI-protected automatically.
///
/// Windows Hello integration uses UserConsentVerifier to show the Hello prompt
/// before the key is retrieved from Credential Manager.

use keyring::Entry;
use base64::Engine;
use crate::error::{Result, VaultError};

const KEYRING_SERVICE: &str = "pv";
const KEYRING_USER: &str = "vault-encryption-key";

/// Store the 32-byte vault key in the OS keychain.
pub fn store_key(key: &[u8; 32]) -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    entry.set_password(&encoded)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    Ok(())
}

/// Retrieve the 32-byte vault key from the OS keychain.
/// On Windows, triggers Windows Hello if configured.
pub fn retrieve_key() -> Result<[u8; 32]> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    let encoded = entry.get_password()
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&encoded)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    if bytes.len() != 32 {
        return Err(VaultError::Keychain("Stored key has wrong length".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Remove the key from the OS keychain (e.g., when changing master password).
pub fn delete_key() -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    entry.delete_credential()
        .map_err(|e| VaultError::Keychain(e.to_string()))?;
    Ok(())
}

/// Check whether a key is currently stored in the keychain.
pub fn is_key_stored() -> bool {
    let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) else { return false; };
    entry.get_password().is_ok()
}

// ─── Windows Hello ────────────────────────────────────────────────────────────

/// Check whether Windows Hello (or equivalent platform biometric) is available.
#[cfg(target_os = "windows")]
pub fn is_biometric_available() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    match UserConsentVerifier::CheckAvailabilityAsync() {
        Ok(op) => {
            // Run the async operation synchronously in this context.
            // Tauri commands run on tokio threads; block_in_place is safe here.
            match tokio::runtime::Handle::try_current() {
                Ok(handle) => tokio::task::block_in_place(|| {
                    handle.block_on(async {
                        op.await.map(|r| r == UserConsentVerifierAvailability::Available).unwrap_or(false)
                    })
                }),
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_biometric_available() -> bool {
    // macOS / Linux: fall back to keychain-only (no biometric gate in Phase 3)
    false
}

/// Show the Windows Hello prompt. Returns true if the user verified successfully.
#[cfg(target_os = "windows")]
pub fn request_windows_hello() -> Result<bool> {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerificationResult};
    use windows::core::HSTRING;

    let op = UserConsentVerifier::RequestVerificationAsync(
        &HSTRING::from("Unlock Password Vault"),
    ).map_err(|e| VaultError::Keychain(e.to_string()))?;

    let result = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::try_current()
            .map_err(|e| VaultError::Other(e.to_string()))
            .map(|handle| handle.block_on(async { op.await }))
    })?
    .map_err(|e| VaultError::Keychain(e.to_string()))?;

    Ok(result == UserConsentVerificationResult::Verified)
}

#[cfg(not(target_os = "windows"))]
pub fn request_windows_hello() -> Result<bool> {
    Ok(false)
}
