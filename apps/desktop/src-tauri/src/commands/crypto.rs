use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand::Rng;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::{Result, VaultError};

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Derive the 32-byte master key from a password and salt using Argon2id.
/// Parameters match the mobile app (m=65536, t=3, p=4).
pub fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let params = Params::new(65536, 3, 4, Some(KEY_LEN))
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    Ok(key)
}

/// Expand the master key into a per-field subkey using HKDF-SHA256.
pub fn hkdf_field_key(master: &[u8; KEY_LEN], field: &str) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, master);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(format!("field_enc:{field}").as_bytes(), key.as_mut())
        .expect("HKDF expand failed — output length is valid");
    key
}

/// Generate 16 cryptographically random bytes for use as an Argon2id salt.
pub fn generate_salt() -> [u8; 16] {
    rand::thread_rng().gen()
}

/// Encrypt plaintext with AES-256-GCM.
/// Wire format (base64): [12-byte nonce][ciphertext+16-byte tag]
pub fn encrypt_field(key: &[u8; KEY_LEN], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    let mut out = nonce.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &out))
}

/// Decrypt AES-256-GCM ciphertext. Fails with Crypto error on bad tag (tamper detection).
pub fn decrypt_field(key: &[u8; KEY_LEN], encoded: &str) -> Result<String> {
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    if data.len() < NONCE_LEN {
        return Err(VaultError::Crypto("Ciphertext too short".into()));
    }

    let nonce = Nonce::from_slice(&data[..NONCE_LEN]);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, &data[NONCE_LEN..])
        .map_err(|_| VaultError::WrongPassword)?;

    String::from_utf8(plaintext).map_err(|e| VaultError::Crypto(e.to_string()))
}

/// Generate a secure random password with the requested character classes.
pub fn generate_password(length: usize, uppercase: bool, digits: bool, symbols: bool) -> String {
    const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const DIGITS: &[u8] = b"0123456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{}|;:,.<>?";

    let mut rng = rand::thread_rng();
    let mut alphabet: Vec<u8> = LOWER.to_vec();
    let mut required: Vec<u8> = vec![*LOWER.get(rng.gen_range(0..LOWER.len())).unwrap()];

    if uppercase {
        alphabet.extend_from_slice(UPPER);
        required.push(*UPPER.get(rng.gen_range(0..UPPER.len())).unwrap());
    }
    if digits {
        alphabet.extend_from_slice(DIGITS);
        required.push(*DIGITS.get(rng.gen_range(0..DIGITS.len())).unwrap());
    }
    if symbols {
        alphabet.extend_from_slice(SYMBOLS);
        required.push(*SYMBOLS.get(rng.gen_range(0..SYMBOLS.len())).unwrap());
    }

    let remaining = length.saturating_sub(required.len());
    let mut chars: Vec<u8> = (0..remaining)
        .map(|_| alphabet[rng.gen_range(0..alphabet.len())])
        .collect();

    chars.extend_from_slice(&required);

    // Fisher-Yates shuffle
    for i in (1..chars.len()).rev() {
        let j = rng.gen_range(0..=i);
        chars.swap(i, j);
    }

    String::from_utf8(chars).expect("password chars are all ASCII")
}
