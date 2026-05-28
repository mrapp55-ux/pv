/**
 * SQL query strings for CRUD operations.
 *
 * All queries are parameterized — never interpolate user data directly.
 * The actual execution is left to the platform-specific DB driver
 * (op-sqlite on React Native, rusqlite on Tauri).
 */

export const Q = {
  // vault_metadata
  initMetadata: `
    INSERT OR IGNORE INTO vault_metadata (id, version, created_at, salt, vault_id, device_id, sync_seq)
    VALUES (1, ?, ?, ?, ?, ?, 0)
  `,
  getMetadata: `SELECT * FROM vault_metadata WHERE id = 1`,
  incrementSyncSeq: `UPDATE vault_metadata SET sync_seq = sync_seq + 1 WHERE id = 1`,

  // vault_entries — list
  listEntries: `
    SELECT id, title, username, url, created_at, modified_at, modified_by
    FROM vault_entries
    WHERE deleted_at IS NULL
    ORDER BY title COLLATE NOCASE ASC
  `,
  searchEntries: `
    SELECT id, title, username, url, created_at, modified_at, modified_by
    FROM vault_entries
    WHERE deleted_at IS NULL
      AND (title LIKE ? OR username LIKE ? OR url LIKE ?)
    ORDER BY title COLLATE NOCASE ASC
  `,

  // vault_entries — single record (includes encrypted fields)
  getEntry: `
    SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL
  `,

  // vault_entries — write
  insertEntry: `
    INSERT INTO vault_entries
      (id, title, username, password_enc, url, notes_enc, created_at, modified_at, modified_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  updateEntry: `
    UPDATE vault_entries
    SET title = ?, username = ?, password_enc = ?, url = ?, notes_enc = ?,
        modified_at = ?, modified_by = ?
    WHERE id = ? AND deleted_at IS NULL
  `,
  softDeleteEntry: `
    UPDATE vault_entries
    SET deleted_at = ?, modified_at = ?, modified_by = ?
    WHERE id = ?
  `,

  // sync_log
  insertSyncLog: `
    INSERT INTO sync_log (entry_id, device_id, seq, action, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `,
  getSyncLogSince: `
    SELECT * FROM sync_log WHERE timestamp > ? ORDER BY timestamp ASC
  `,

  // sync_state
  upsertSyncState: `
    INSERT INTO sync_state (provider, last_revision, last_sync_at, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      last_revision = excluded.last_revision,
      last_sync_at  = excluded.last_sync_at,
      status        = excluded.status
  `,
  getSyncState: `SELECT * FROM sync_state WHERE provider = ?`,
} as const;
