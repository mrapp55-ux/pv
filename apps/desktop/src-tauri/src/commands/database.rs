use rusqlite::{params, Connection};
use std::path::Path;
use uuid::Uuid;

use crate::error::{Result, VaultError};
use crate::commands::crypto::{decrypt_field, encrypt_field};
use crate::state::SessionKey;

/// SQLCipher PRAGMA sequence. kdf_iter=1 because Argon2id does the KDF.
/// The PRAGMA key must be the very first statement executed on the connection.
pub fn open_encrypted(path: &Path, key_hex: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(&format!(
        "PRAGMA key = \"x'{key_hex}'\";\n\
         PRAGMA cipher_page_size = 4096;\n\
         PRAGMA kdf_iter = 1;\n\
         PRAGMA cipher_hmac_algorithm = HMAC_SHA512;\n\
         PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;\n\
         PRAGMA journal_mode = WAL;\n\
         PRAGMA foreign_keys = ON;"
    ))?;
    Ok(conn)
}

pub fn migrate_schema(conn: &Connection) -> Result<()> {
    // Idempotent column additions — silently skip if already present
    let _ = conn.execute_batch(
        "ALTER TABLE vault_entries ADD COLUMN security_questions_enc TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE vault_entries ADD COLUMN group_id TEXT;"
    );
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS groups (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
        );"
    )?;
    // Seed default group for vaults that predate groups
    ensure_default_group(conn)?;
    // Assign ungrouped entries to the default group
    conn.execute_batch(
        "UPDATE vault_entries
         SET group_id = (SELECT id FROM groups ORDER BY created_at ASC LIMIT 1)
         WHERE group_id IS NULL AND deleted_at IS NULL;"
    )?;
    Ok(())
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vault_metadata (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            version    INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            salt       TEXT NOT NULL,
            vault_id   TEXT NOT NULL,
            device_id  TEXT NOT NULL,
            sync_seq   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS groups (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_entries (
            id                       TEXT PRIMARY KEY,
            title                    TEXT NOT NULL,
            username                 TEXT,
            password_enc             TEXT NOT NULL,
            url                      TEXT,
            notes_enc                TEXT,
            security_questions_enc   TEXT,
            group_id                 TEXT,
            created_at               INTEGER NOT NULL,
            modified_at              INTEGER NOT NULL,
            deleted_at               INTEGER,
            modified_by              TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id  TEXT NOT NULL,
            device_id TEXT NOT NULL,
            seq       INTEGER NOT NULL,
            action    TEXT NOT NULL CHECK (action IN ('create','update','delete')),
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_state (
            provider      TEXT PRIMARY KEY,
            last_revision TEXT,
            last_sync_at  INTEGER,
            status        TEXT NOT NULL DEFAULT 'idle'
        );
        CREATE INDEX IF NOT EXISTS idx_entries_modified
            ON vault_entries(modified_at) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_entries_title
            ON vault_entries(title COLLATE NOCASE) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_entries_group
            ON vault_entries(group_id) WHERE deleted_at IS NULL;",
    )?;
    Ok(())
}

/// Seed the "Muki" default group if no groups exist yet. Returns the group id.
pub fn ensure_default_group(conn: &Connection) -> Result<String> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM groups", [], |r| r.get(0))?;
    if count == 0 {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO groups (id, name, created_at) VALUES (?1, 'Muki', ?2)",
            params![id, now_ms()],
        )?;
    }
    let id: String = conn.query_row(
        "SELECT id FROM groups ORDER BY created_at ASC LIMIT 1",
        [],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn insert_metadata(
    conn: &Connection,
    salt_b64: &str,
    vault_id: &str,
    device_id: &str,
) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT OR IGNORE INTO vault_metadata (id, version, created_at, salt, vault_id, device_id, sync_seq)
         VALUES (1, 1, ?1, ?2, ?3, ?4, 0)",
        params![now, salt_b64, vault_id, device_id],
    )?;
    Ok(())
}

pub fn get_salt(conn: &Connection) -> Result<Option<String>> {
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT salt FROM vault_metadata WHERE id = 1",
        [],
        |row| row.get(0),
    );
    match result {
        Ok(salt) => Ok(Some(salt)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ─── Group types & CRUD ───────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

pub fn list_groups(conn: &Connection) -> Result<Vec<Group>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at FROM groups ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Group { id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)? })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
}

pub fn create_group(conn: &Connection, name: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO groups (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, now_ms()],
    )?;
    Ok(id)
}

pub fn rename_group(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let rows = conn.execute(
        "UPDATE groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    if rows == 0 { return Err(VaultError::NotFound(id.into())); }
    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM groups", [], |r| r.get(0))?;
    if count <= 1 {
        return Err(VaultError::Other("Cannot delete the last group.".into()));
    }
    let fallback: String = conn.query_row(
        "SELECT id FROM groups WHERE id != ?1 ORDER BY created_at ASC LIMIT 1",
        params![id],
        |r| r.get(0),
    )?;
    conn.execute(
        "UPDATE vault_entries SET group_id = ?1 WHERE group_id = ?2",
        params![fallback, id],
    )?;
    let rows = conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
    if rows == 0 { return Err(VaultError::NotFound(id.into())); }
    Ok(())
}

// ─── Entry types ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SecurityQuestion {
    pub question: String,
    pub answer: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct EntryListItem {
    pub id: String,
    pub title: String,
    pub username: Option<String>,
    pub url: Option<String>,
    pub modified_at: i64,
    pub group_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct EntryDetail {
    pub id: String,
    pub title: String,
    pub username: Option<String>,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub security_questions: Option<Vec<SecurityQuestion>>,
    pub group_id: Option<String>,
    pub created_at: i64,
    pub modified_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct EntryInput {
    pub title: String,
    pub username: Option<String>,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub security_questions: Option<Vec<SecurityQuestion>>,
    pub group_id: Option<String>,
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

pub fn list_entries(conn: &Connection) -> Result<Vec<EntryListItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, username, url, modified_at, group_id
         FROM vault_entries WHERE deleted_at IS NULL
         ORDER BY title COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(EntryListItem {
            id: row.get(0)?,
            title: row.get(1)?,
            username: row.get(2)?,
            url: row.get(3)?,
            modified_at: row.get(4)?,
            group_id: row.get(5)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
}

pub fn get_entry(conn: &Connection, session: &SessionKey, id: &str) -> Result<EntryDetail> {
    let row: rusqlite::Result<(String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, i64)> =
        conn.query_row(
            "SELECT id, title, username, password_enc, url, notes_enc, security_questions_enc, group_id, created_at, modified_at
             FROM vault_entries WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?,
                row.get(3)?, row.get(4)?, row.get(5)?,
                row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?,
            )),
        );

    match row {
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(VaultError::NotFound(id.into())),
        Err(e) => Err(e.into()),
        Ok((eid, title, username, password_enc, url, notes_enc, sq_enc, group_id, created_at, modified_at)) => {
            let password = decrypt_field(&session.field_password, &password_enc)?;
            let notes = notes_enc.map(|n| decrypt_field(&session.field_notes, &n)).transpose()?;
            let security_questions = sq_enc.map(|sq| {
                let json = decrypt_field(&session.field_security_questions, &sq)?;
                serde_json::from_str::<Vec<SecurityQuestion>>(&json)
                    .map_err(|e| VaultError::Crypto(e.to_string()))
            }).transpose()?;
            Ok(EntryDetail { id: eid, title, username, password, url, notes, security_questions, group_id, created_at, modified_at })
        }
    }
}

pub fn create_entry(conn: &Connection, session: &SessionKey, input: EntryInput, device_id: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let password_enc = encrypt_field(&session.field_password, &input.password)?;
    let notes_enc = input.notes.as_deref().map(|n| encrypt_field(&session.field_notes, n)).transpose()?;
    let sq_enc = encrypt_security_questions(session, &input.security_questions)?;

    conn.execute(
        "INSERT INTO vault_entries (id, title, username, password_enc, url, notes_enc, security_questions_enc, group_id, created_at, modified_at, modified_by)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10)",
        params![id, input.title, input.username, password_enc, input.url, notes_enc, sq_enc, input.group_id, now, device_id],
    )?;
    log_sync(conn, &id, device_id, "create")?;
    Ok(id)
}

pub fn update_entry(conn: &Connection, session: &SessionKey, id: &str, input: EntryInput, device_id: &str) -> Result<()> {
    let now = now_ms();
    let password_enc = encrypt_field(&session.field_password, &input.password)?;
    let notes_enc = input.notes.as_deref().map(|n| encrypt_field(&session.field_notes, n)).transpose()?;
    let sq_enc = encrypt_security_questions(session, &input.security_questions)?;

    let rows = conn.execute(
        "UPDATE vault_entries SET title=?1, username=?2, password_enc=?3, url=?4, notes_enc=?5,
         security_questions_enc=?6, group_id=?7, modified_at=?8, modified_by=?9 WHERE id=?10 AND deleted_at IS NULL",
        params![input.title, input.username, password_enc, input.url, notes_enc, sq_enc, input.group_id, now, device_id, id],
    )?;
    if rows == 0 { return Err(VaultError::NotFound(id.into())); }
    log_sync(conn, id, device_id, "update")?;
    Ok(())
}

fn encrypt_security_questions(session: &SessionKey, sqs: &Option<Vec<SecurityQuestion>>) -> Result<Option<String>> {
    match sqs {
        Some(list) if !list.is_empty() => {
            let json = serde_json::to_string(list)
                .map_err(|e| VaultError::Crypto(e.to_string()))?;
            Ok(Some(encrypt_field(&session.field_security_questions, &json)?))
        }
        _ => Ok(None),
    }
}

pub fn delete_entry(conn: &Connection, id: &str, device_id: &str) -> Result<()> {
    let now = now_ms();
    let rows = conn.execute(
        "UPDATE vault_entries SET deleted_at=?1, modified_at=?1, modified_by=?2 WHERE id=?3",
        params![now, device_id, id],
    )?;
    if rows == 0 { return Err(VaultError::NotFound(id.into())); }
    log_sync(conn, id, device_id, "delete")?;
    Ok(())
}

fn log_sync(conn: &Connection, entry_id: &str, device_id: &str, action: &str) -> Result<()> {
    let seq: i64 = conn.query_row(
        "SELECT sync_seq FROM vault_metadata WHERE id = 1", [], |r| r.get(0)
    ).unwrap_or(0);
    conn.execute(
        "INSERT INTO sync_log (entry_id, device_id, seq, action, timestamp) VALUES (?1,?2,?3,?4,?5)",
        params![entry_id, device_id, seq, action, now_ms()],
    )?;
    conn.execute("UPDATE vault_metadata SET sync_seq = sync_seq + 1 WHERE id = 1", [])?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
