pub mod biometric;
pub mod crypto;
pub mod database;
pub mod sync;

use tauri::State;

use crate::error::{Result, VaultError};
use crate::state::{AppState, SessionKey};
use crypto::{derive_key, generate_salt, hkdf_field_key};
use database::{
    delete_entry, get_entry, insert_metadata, init_schema, migrate_schema, list_entries,
    open_encrypted, create_entry, update_entry, get_salt, EntryDetail, EntryInput, EntryListItem,
};
use biometric::{is_biometric_available, is_key_stored, request_windows_hello, retrieve_key, store_key};
pub use sync::{cmd_get_vault_folder, cmd_set_vault_folder, cmd_move_vault, cmd_detect_google_drive};

fn device_id() -> String {
    const SVC: &str = "password-vault-device";
    const USR: &str = "device-id";
    if let Ok(entry) = keyring::Entry::new(SVC, USR) {
        if let Ok(id) = entry.get_password() {
            return id;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let _ = entry.set_password(&id);
        return id;
    }
    uuid::Uuid::new_v4().to_string()
}

// ─── Auth commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_is_vault_initialized() -> bool {
    sync::vault_path().exists()
}

#[tauri::command]
pub fn cmd_is_unlocked(state: State<AppState>) -> bool {
    state.session.lock().unwrap().is_some()
}

#[tauri::command]
pub fn cmd_is_biometric_available() -> bool {
    is_biometric_available() && is_key_stored()
}

/// First-time setup: derive key, init DB, optionally store key in keychain.
#[tauri::command]
pub fn cmd_initialize_vault(
    password: String,
    enable_biometric: bool,
    state: State<AppState>,
) -> Result<()> {
    let path = sync::vault_path();
    std::fs::create_dir_all(path.parent().unwrap())?;

    let salt = generate_salt();
    let salt_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt);
    let master = derive_key(&password, &salt)?;
    let fp = hkdf_field_key(&master, "password");
    let fn_ = hkdf_field_key(&master, "notes");
    let fsq = hkdf_field_key(&master, "security_questions");
    let key_hex = hex::encode(*master);

    let conn = open_encrypted(&path, &key_hex)?;
    init_schema(&conn)?;
    migrate_schema(&conn)?;

    let vault_id = uuid::Uuid::new_v4().to_string();
    let did = device_id();
    insert_metadata(&conn, &salt_b64, &vault_id, &did)?;

    // Write the salt to a plaintext sidecar so it can be read before the DB is opened.
    // The salt is not secret — it only needs to be unique. Google Drive syncs this file
    // alongside vault.db to all machines automatically.
    std::fs::write(sync::salt_path(), &salt_b64)?;

    if enable_biometric {
        store_key(&master)?;
    }

    let session = SessionKey::new(*master, *fp, *fn_, *fsq);
    *state.session.lock().unwrap() = Some(session);
    *state.db.lock().unwrap() = Some(conn);
    Ok(())
}

/// Unlock with master password: re-derive key, open DB.
#[tauri::command]
pub fn cmd_unlock_vault(password: String, state: State<AppState>) -> Result<()> {
    let path = sync::vault_path();
    if !path.exists() {
        return Err(VaultError::Other("Vault not initialized".into()));
    }

    let salt_b64 = std::fs::read_to_string(sync::salt_path())
        .map_err(|_| VaultError::Other("Salt file missing — vault may be corrupt".into()))?;
    let salt = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &salt_b64)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    let master = derive_key(&password, &salt)?;
    let key_hex = hex::encode(*master);

    let conn = open_encrypted(&path, &key_hex)
        .map_err(|_| VaultError::WrongPassword)?;

    get_salt(&conn)?.ok_or(VaultError::WrongPassword)?;
    migrate_schema(&conn)?;

    let fp = hkdf_field_key(&master, "password");
    let fn_ = hkdf_field_key(&master, "notes");
    let fsq = hkdf_field_key(&master, "security_questions");
    let session = SessionKey::new(*master, *fp, *fn_, *fsq);
    *state.session.lock().unwrap() = Some(session);
    *state.db.lock().unwrap() = Some(conn);
    Ok(())
}

/// Unlock with Windows Hello / OS keychain — no password needed.
#[tauri::command]
pub fn cmd_unlock_biometric(state: State<AppState>) -> Result<()> {
    if !is_biometric_available() {
        return Err(VaultError::Other("Biometric unlock not available".into()));
    }

    if !request_windows_hello()? {
        return Err(VaultError::Other("Biometric verification failed".into()));
    }

    let master = retrieve_key()?;
    let path = sync::vault_path();
    let key_hex = hex::encode(master);
    let conn = open_encrypted(&path, &key_hex)?;
    migrate_schema(&conn)?;

    let fp = hkdf_field_key(&master, "password");
    let fn_ = hkdf_field_key(&master, "notes");
    let fsq = hkdf_field_key(&master, "security_questions");
    let session = SessionKey::new(master, *fp, *fn_, *fsq);
    *state.session.lock().unwrap() = Some(session);
    *state.db.lock().unwrap() = Some(conn);
    Ok(())
}

/// Lock: zero key material and close the DB connection.
#[tauri::command]
pub fn cmd_lock(state: State<AppState>) {
    *state.session.lock().unwrap() = None;
    *state.db.lock().unwrap() = None;
}

/// Delete vault: close DB, zero session, delete vault.db + vault.salt + config + keychain entry.
#[tauri::command]
pub fn cmd_delete_vault(state: State<AppState>) -> Result<()> {
    *state.session.lock().unwrap() = None;
    *state.db.lock().unwrap() = None;

    let db = sync::vault_path();
    let salt = sync::salt_path();
    if db.exists() { std::fs::remove_file(&db)?; }
    if salt.exists() { std::fs::remove_file(&salt)?; }

    let config = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("PasswordVault")
        .join("config.json");
    if config.exists() { std::fs::remove_file(&config)?; }

    let _ = biometric::delete_key();
    Ok(())
}

/// Enable biometric unlock by storing the current session key in keychain.
#[tauri::command]
pub fn cmd_enable_biometric(state: State<AppState>) -> Result<()> {
    let guard = state.session.lock().unwrap();
    let session = guard.as_ref().ok_or(VaultError::Locked)?;
    store_key(&session.master)
}

/// Disable biometric unlock by removing the key from keychain.
#[tauri::command]
pub fn cmd_disable_biometric() -> Result<()> {
    biometric::delete_key()
}

/// Move vault files to a new folder while session is active, then reopen from new location.
#[tauri::command]
pub fn cmd_relocate_vault(new_folder: String, state: State<AppState>) -> Result<()> {
    // Close DB before moving files
    *state.db.lock().unwrap() = None;

    // Copy files + update config
    sync::cmd_move_vault(new_folder)?;

    // Reopen DB using the existing in-memory session key
    let guard = state.session.lock().unwrap();
    let session = guard.as_ref().ok_or(VaultError::Locked)?;
    let key_hex = hex::encode(*session.master);
    drop(guard);

    let conn = open_encrypted(&sync::vault_path(), &key_hex)?;
    *state.db.lock().unwrap() = Some(conn);
    Ok(())
}

// ─── Vault CRUD commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_entries(state: State<AppState>) -> Result<Vec<EntryListItem>> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    list_entries(conn)
}

#[tauri::command]
pub fn cmd_get_entry(id: String, state: State<AppState>) -> Result<EntryDetail> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    get_entry(conn, session, &id)
}

#[tauri::command]
pub fn cmd_create_entry(entry: EntryInput, state: State<AppState>) -> Result<String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    create_entry(conn, session, entry, &device_id())
}

#[tauri::command]
pub fn cmd_update_entry(id: String, entry: EntryInput, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    update_entry(conn, session, &id, entry, &device_id())
}

#[tauri::command]
pub fn cmd_delete_entry(id: String, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    delete_entry(conn, &id, &device_id())
}

#[tauri::command]
pub fn cmd_generate_password(
    length: Option<usize>,
    uppercase: Option<bool>,
    digits: Option<bool>,
    symbols: Option<bool>,
) -> String {
    crypto::generate_password(
        length.unwrap_or(20),
        uppercase.unwrap_or(true),
        digits.unwrap_or(true),
        symbols.unwrap_or(true),
    )
}
