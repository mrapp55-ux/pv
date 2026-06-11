pub mod biometric;
pub mod crypto;
pub mod database;
pub mod sync;

use tauri::State;

use crate::error::{Result, VaultError};
use crate::state::{AppState, SessionKey};
use crypto::{derive_key, generate_salt, hkdf_field_key, encrypt_field, decrypt_field};
use database::{
    delete_entry, get_entry, insert_metadata, init_schema, migrate_schema, list_entries,
    open_encrypted, create_entry, update_entry, get_salt, ensure_default_group,
    list_groups, create_group, rename_group, delete_group,
    EntryDetail, EntryInput, EntryListItem, Group,
};
use biometric::{is_biometric_available, is_key_stored, request_windows_hello, retrieve_key, store_key};
pub use sync::{
    cmd_get_vault_folder, cmd_set_vault_folder, cmd_move_vault, cmd_detect_google_drive,
    cmd_get_auto_lock_seconds, cmd_set_auto_lock_seconds,
    cmd_get_vault_location, cmd_set_use_google_drive,
    cmd_write_file, cmd_backup_vault,
};

fn device_id() -> String {
    const SVC: &str = "pv-device";
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
    ensure_default_group(&conn)?;

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

/// Change master password: verify old password, re-encrypt all fields, rekey the DB.
#[tauri::command]
pub fn cmd_change_master_password(
    old_password: String,
    new_password: String,
    state: State<AppState>,
) -> Result<()> {
    // 1. Verify old password matches the current session key
    let salt_b64 = std::fs::read_to_string(sync::salt_path())
        .map_err(|_| VaultError::Other("Salt file missing".into()))?;
    let old_salt = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &salt_b64)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let old_master = derive_key(&old_password, &old_salt)?;
    {
        let guard = state.session.lock().unwrap();
        let session = guard.as_ref().ok_or(VaultError::Locked)?;
        if *old_master != *session.master {
            return Err(VaultError::WrongPassword);
        }
    }

    // 2. Derive new key material
    let new_salt_bytes = generate_salt();
    let new_master = derive_key(&new_password, &new_salt_bytes)?;
    let new_fp  = hkdf_field_key(&new_master, "password");
    let new_fn_ = hkdf_field_key(&new_master, "notes");
    let new_fsq = hkdf_field_key(&new_master, "security_questions");
    let new_key_hex = hex::encode(*new_master);
    let new_salt_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt_bytes);

    // 3. Re-encrypt all entry fields in a single transaction
    {
        let db_guard  = state.db.lock().unwrap();
        let conn      = db_guard.as_ref().ok_or(VaultError::Locked)?;
        let sess_guard = state.session.lock().unwrap();
        let session   = sess_guard.as_ref().ok_or(VaultError::Locked)?;

        let entries: Vec<(String, String, Option<String>, Option<String>)> = {
            let mut stmt = conn.prepare(
                "SELECT id, password_enc, notes_enc, security_questions_enc
                 FROM vault_entries WHERE deleted_at IS NULL"
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        conn.execute_batch("BEGIN")?;
        for (id, pw_enc, notes_enc, sq_enc) in &entries {
            let new_pw = {
                let plain = decrypt_field(&session.field_password, pw_enc)?;
                encrypt_field(&new_fp, &plain)?
            };
            let new_notes = notes_enc.as_deref()
                .map(|n| { let p = decrypt_field(&session.field_notes, n)?; encrypt_field(&new_fn_, &p) })
                .transpose()?;
            let new_sq = sq_enc.as_deref()
                .map(|sq| { let p = decrypt_field(&session.field_security_questions, sq)?; encrypt_field(&new_fsq, &p) })
                .transpose()?;
            conn.execute(
                "UPDATE vault_entries SET password_enc=?1, notes_enc=?2, security_questions_enc=?3 WHERE id=?4",
                rusqlite::params![new_pw, new_notes, new_sq, id],
            )?;
        }
        conn.execute("UPDATE vault_metadata SET salt=?1 WHERE id=1", rusqlite::params![new_salt_b64])?;
        conn.execute_batch("COMMIT")?;

        // Rekey the SQLCipher database (uses same cipher params already set on connection)
        conn.execute_batch(&format!("PRAGMA rekey = \"x'{new_key_hex}'\";"))?;
    }

    // 4. Update salt sidecar file
    std::fs::write(sync::salt_path(), &new_salt_b64)?;

    // 5. Replace in-memory session with new keys
    *state.session.lock().unwrap() = Some(SessionKey::new(*new_master, *new_fp, *new_fn_, *new_fsq));

    // 6. Update biometric keychain entry if one exists
    if is_key_stored() {
        let _ = store_key(&new_master);
    }

    Ok(())
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

// ─── PWA sidecar ──────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SidecarEntry {
    id: String,
    title: String,
    username: Option<String>,
    password: String,
    url: Option<String>,
    notes: Option<String>,
    security_questions: Option<Vec<database::SecurityQuestion>>,
    group_id: Option<String>,
    modified_at: i64,
}

#[derive(serde::Serialize)]
struct SidecarPayload {
    version: u32,
    groups: Vec<Group>,
    entries: Vec<SidecarEntry>,
}

/// Build and write vault.enc alongside vault.db.
/// Errors are silently ignored — sidecar failure must not block vault mutations.
fn write_sidecar(conn: &rusqlite::Connection, session: &SessionKey) {
    let _ = write_sidecar_inner(conn, session);
}

fn write_sidecar_inner(conn: &rusqlite::Connection, session: &SessionKey) -> Result<()> {
    let groups = list_groups(conn)?;

    let mut stmt = conn.prepare(
        "SELECT id, title, username, password_enc, url, notes_enc, security_questions_enc, group_id, modified_at
         FROM vault_entries WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE ASC"
    )?;
    let entries: Vec<SidecarEntry> = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, i64>(8)?,
        ))
    })?
    .filter_map(|r| r.ok())
    .filter_map(|(id, title, username, pw_enc, url, notes_enc, sq_enc, group_id, modified_at)| {
        let password = decrypt_field(&session.field_password, &pw_enc).ok()?;
        let notes = notes_enc.as_deref().and_then(|n| decrypt_field(&session.field_notes, n).ok());
        let security_questions = sq_enc.as_deref().and_then(|sq| {
            let json = decrypt_field(&session.field_security_questions, sq).ok()?;
            serde_json::from_str::<Vec<database::SecurityQuestion>>(&json).ok()
        });
        Some(SidecarEntry { id, title, username, password, url, notes, security_questions, group_id, modified_at })
    })
    .collect();

    let payload = SidecarPayload { version: 1, groups, entries };
    let json = serde_json::to_string(&payload)
        .map_err(|e| VaultError::Other(e.to_string()))?;

    let sidecar_key = hkdf_field_key(&session.master, "pwa_sidecar");
    let encrypted = encrypt_field(&sidecar_key, &json)?;

    let path = sync::vault_path().with_extension("enc");
    std::fs::write(path, encrypted)?;
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
    let id = create_entry(conn, session, entry, &device_id())?;
    write_sidecar(conn, session);
    Ok(id)
}

#[tauri::command]
pub fn cmd_update_entry(id: String, entry: EntryInput, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    update_entry(conn, session, &id, entry, &device_id())?;
    write_sidecar(conn, session);
    Ok(())
}

#[tauri::command]
pub fn cmd_delete_entry(id: String, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    delete_entry(conn, &id, &device_id())?;
    write_sidecar(conn, session);
    Ok(())
}

// ─── Group commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_list_groups(state: State<AppState>) -> Result<Vec<Group>> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    list_groups(conn)
}

#[tauri::command]
pub fn cmd_create_group(name: String, state: State<AppState>) -> Result<String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    create_group(conn, &name)
}

#[tauri::command]
pub fn cmd_rename_group(id: String, name: String, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    rename_group(conn, &id, &name)
}

#[tauri::command]
pub fn cmd_delete_group(id: String, state: State<AppState>) -> Result<()> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or(VaultError::Locked)?;
    let sess_guard = state.session.lock().unwrap();
    let session = sess_guard.as_ref().ok_or(VaultError::Locked)?;
    delete_group(conn, &id)?;
    write_sidecar(conn, session);
    Ok(())
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
