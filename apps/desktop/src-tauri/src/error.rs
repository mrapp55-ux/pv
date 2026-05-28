use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Vault is locked")]
    Locked,
    #[error("Wrong master password")]
    WrongPassword,
    #[error("Entry not found: {0}")]
    NotFound(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Keychain error: {0}")]
    Keychain(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for VaultError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;
