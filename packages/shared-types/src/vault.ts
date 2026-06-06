export interface Group {
  id: string;
  name: string;
  createdAt: number;
}

export interface VaultEntry {
  id: string;
  title: string;
  username: string | null;
  /** Raw plaintext password — only in memory, never persisted decrypted */
  password: string;
  url: string | null;
  notes: string | null;
  groupId: string;
  createdAt: number;
  modifiedAt: number;
  deletedAt: number | null;
  modifiedBy: string;
}

export interface VaultEntryEncrypted {
  id: string;
  title: string;
  username: string | null;
  /** AES-256-GCM ciphertext (base64) */
  passwordEnc: string;
  url: string | null;
  /** AES-256-GCM ciphertext (base64) */
  notesEnc: string | null;
  groupId: string;
  createdAt: number;
  modifiedAt: number;
  deletedAt: number | null;
  modifiedBy: string;
}

export interface VaultMetadata {
  version: number;
  createdAt: number;
  /** 16-byte Argon2id salt, base64 encoded */
  salt: string;
  /** UUID v4, anti-swap protection */
  vaultId: string;
  deviceId: string;
  syncSeq: number;
}
