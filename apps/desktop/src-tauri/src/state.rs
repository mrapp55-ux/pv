use std::sync::Mutex;
use rusqlite::Connection;
use zeroize::Zeroizing;

/// Per-field HKDF-derived keys, held in memory only while the vault is unlocked.
pub struct SessionKey {
    pub master: Zeroizing<[u8; 32]>,
    pub field_password: Zeroizing<[u8; 32]>,
    pub field_notes: Zeroizing<[u8; 32]>,
    pub field_security_questions: Zeroizing<[u8; 32]>,
}

impl SessionKey {
    pub fn new(master: [u8; 32], field_password: [u8; 32], field_notes: [u8; 32], field_security_questions: [u8; 32]) -> Self {
        Self {
            master: Zeroizing::new(master),
            field_password: Zeroizing::new(field_password),
            field_notes: Zeroizing::new(field_notes),
            field_security_questions: Zeroizing::new(field_security_questions),
        }
    }
}

/// Global app state managed by Tauri.
/// Both fields are behind Mutex so they are Send + Sync.
pub struct AppState {
    pub session: Mutex<Option<SessionKey>>,
    pub db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            db: Mutex::new(None),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
