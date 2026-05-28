/**
 * SQLCipher database service for React Native (op-sqlite).
 *
 * Initialization sequence (critical — do NOT reorder):
 *   1. PRAGMA key  — must be first statement after open
 *   2. Cipher pragmas
 *   3. Schema creation / migrations
 *
 * The 32-byte master key (from Argon2id) is converted to hex and passed
 * as a raw key to SQLCipher via `x'<hex>'` syntax, bypassing SQLCipher's
 * internal PBKDF2 (kdf_iter=1).
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import { getMasterKey, encrypt, decrypt, getFieldKey } from '@vault/shared-crypto';
import { CREATE_TABLES, Q, SCHEMA_VERSION, pendingMigrations } from '@vault/shared-db';
import type { VaultEntry, VaultMetadata } from '@vault/shared-types';
import * as FileSystem from 'expo-file-system';

const DB_NAME = 'vault.db';

let db: DB | null = null;

function dbPath(): string {
  return FileSystem.documentDirectory + DB_NAME;
}

/** Convert Uint8Array to lowercase hex string for SQLCipher PRAGMA key. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Open (or create) the encrypted database with the session's master key. */
export async function openDatabase(): Promise<void> {
  if (db) return;

  const key = getMasterKey(); // throws if vault is locked
  const hexKey = toHex(key);

  db = open({ name: DB_NAME, location: FileSystem.documentDirectory ?? undefined });

  // SQLCipher key must be set BEFORE any other statements
  await db.executeAsync(`PRAGMA key = "x'${hexKey}'"`, []);
  await db.executeAsync(`PRAGMA cipher_page_size = 4096`, []);
  await db.executeAsync(`PRAGMA kdf_iter = 1`, []);
  await db.executeAsync(`PRAGMA cipher_hmac_algorithm = HMAC_SHA512`, []);
  await db.executeAsync(`PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512`, []);
  await db.executeAsync(`PRAGMA journal_mode = WAL`, []);
  await db.executeAsync(`PRAGMA foreign_keys = ON`, []);

  // Create schema
  await db.executeAsync(CREATE_TABLES, []);

  // Run pending migrations
  const { rows } = await db.executeAsync(`PRAGMA user_version`, []);
  const currentVersion = (rows?.[0] as { user_version: number } | undefined)?.user_version ?? 0;
  for (const m of pendingMigrations(currentVersion)) {
    await db.executeAsync(m.sql, []);
    await db.executeAsync(`PRAGMA user_version = ${m.version}`, []);
  }
}

/** Close and forget the DB handle (called on lock). */
export function closeDatabase(): void {
  db?.close();
  db = null;
}

function getDb(): DB {
  if (!db) throw new Error('Database is not open — call openDatabase() first');
  return db;
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function initMetadata(meta: Omit<VaultMetadata, 'syncSeq'>): Promise<void> {
  await getDb().executeAsync(Q.initMetadata, [
    SCHEMA_VERSION,
    meta.createdAt,
    meta.salt,
    meta.vaultId,
    meta.deviceId,
  ]);
}

export async function getMetadata(): Promise<VaultMetadata | null> {
  const { rows } = await getDb().executeAsync(Q.getMetadata, []);
  if (!rows?.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    version: r['version'] as number,
    createdAt: r['created_at'] as number,
    salt: r['salt'] as string,
    vaultId: r['vault_id'] as string,
    deviceId: r['device_id'] as string,
    syncSeq: r['sync_seq'] as number,
  };
}

// ─── Entries ─────────────────────────────────────────────────────────────────

/** Encrypt fields and insert a new entry. Returns the entry id. */
export async function createEntry(
  entry: Omit<VaultEntry, 'id' | 'createdAt' | 'modifiedAt' | 'deletedAt'> & {
    id: string;
    deviceId: string;
  },
): Promise<string> {
  const passKey = await getFieldKey('password');
  const notesKey = await getFieldKey('notes');

  const passwordEnc = await encrypt(passKey, entry.password);
  const notesEnc = entry.notes ? await encrypt(notesKey, entry.notes) : null;
  const now = Date.now();

  await getDb().executeAsync(Q.insertEntry, [
    entry.id,
    entry.title,
    entry.username,
    passwordEnc,
    entry.url,
    notesEnc,
    now,
    now,
    entry.deviceId,
  ]);

  await logSync(entry.id, entry.deviceId, 'create');
  return entry.id;
}

/** Fetch a single entry with decrypted fields. */
export async function getEntry(id: string): Promise<VaultEntry | null> {
  const { rows } = await getDb().executeAsync(Q.getEntry, [id]);
  if (!rows?.length) return null;
  return decryptRow(rows[0] as Record<string, unknown>);
}

/** List all active entries (title, username, url only — no decryption needed). */
export async function listEntries(): Promise<Omit<VaultEntry, 'password' | 'notes'>[]> {
  const { rows } = await getDb().executeAsync(Q.listEntries, []);
  return (rows ?? []).map(r => {
    const row = r as Record<string, unknown>;
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      username: (row['username'] as string | null) ?? null,
      url: (row['url'] as string | null) ?? null,
      createdAt: row['created_at'] as number,
      modifiedAt: row['modified_at'] as number,
      deletedAt: null,
      modifiedBy: row['modified_by'] as string,
    };
  });
}

/** Update an existing entry with new field values. */
export async function updateEntry(
  entry: VaultEntry & { deviceId: string },
): Promise<void> {
  const passKey = await getFieldKey('password');
  const notesKey = await getFieldKey('notes');

  const passwordEnc = await encrypt(passKey, entry.password);
  const notesEnc = entry.notes ? await encrypt(notesKey, entry.notes) : null;
  const now = Date.now();

  await getDb().executeAsync(Q.updateEntry, [
    entry.title,
    entry.username,
    passwordEnc,
    entry.url,
    notesEnc,
    now,
    entry.deviceId,
    entry.id,
  ]);

  await logSync(entry.id, entry.deviceId, 'update');
}

/** Soft-delete an entry (sets deleted_at, never removes the row). */
export async function deleteEntry(id: string, deviceId: string): Promise<void> {
  const now = Date.now();
  await getDb().executeAsync(Q.softDeleteEntry, [now, now, deviceId, id]);
  await logSync(id, deviceId, 'delete');
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function decryptRow(row: Record<string, unknown>): Promise<VaultEntry> {
  const passKey = await getFieldKey('password');
  const notesKey = await getFieldKey('notes');

  const password = await decrypt(passKey, row['password_enc'] as string);
  const notes = row['notes_enc']
    ? await decrypt(notesKey, row['notes_enc'] as string)
    : null;

  return {
    id: row['id'] as string,
    title: row['title'] as string,
    username: (row['username'] as string | null) ?? null,
    password,
    url: (row['url'] as string | null) ?? null,
    notes,
    createdAt: row['created_at'] as number,
    modifiedAt: row['modified_at'] as number,
    deletedAt: (row['deleted_at'] as number | null) ?? null,
    modifiedBy: row['modified_by'] as string,
  };
}

async function logSync(
  entryId: string,
  deviceId: string,
  action: 'create' | 'update' | 'delete',
): Promise<void> {
  const { rows } = await getDb().executeAsync(Q.getMetadata, []);
  const seq = ((rows?.[0] as Record<string, unknown>)?.['sync_seq'] as number) ?? 0;
  await getDb().executeAsync(Q.insertSyncLog, [entryId, deviceId, seq, action, Date.now()]);
  await getDb().executeAsync(Q.incrementSyncSeq, []);
}
