/** SQLite DDL statements. Executed in order during vault initialization. */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS vault_metadata (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  salt       TEXT NOT NULL,
  vault_id   TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  sync_seq   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vault_entries (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  username     TEXT,
  password_enc TEXT NOT NULL,
  url          TEXT,
  notes_enc    TEXT,
  created_at   INTEGER NOT NULL,
  modified_at  INTEGER NOT NULL,
  deleted_at   INTEGER,
  modified_by  TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_sync_log_entry
  ON sync_log(entry_id, timestamp);
`;

/** PRAGMA sequence for SQLCipher. kdf_iter=1 because we use Argon2id externally. */
export const SQLCIPHER_PRAGMAS = (hexKey: string) => `
PRAGMA key = "x'${hexKey}'";
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 1;
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
`;
