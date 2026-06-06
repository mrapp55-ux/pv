/**
 * Schema migrations. Each entry runs exactly once, gated by user_version PRAGMA.
 *
 * Add new migrations at the END of the array — never edit existing ones.
 * The version number is 1-indexed and corresponds to the array index + 1.
 */

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      -- v1: initial schema (created by CREATE_TABLES, nothing additional needed)
      SELECT 1;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS groups (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE vault_entries ADD COLUMN group_id TEXT;
    `,
  },
];

/**
 * Returns the SQL to run all pending migrations for a given current version.
 * Platform-specific drivers call this and execute the returned SQL.
 */
export function pendingMigrations(currentVersion: number): Migration[] {
  return MIGRATIONS.filter(m => m.version > currentVersion);
}
