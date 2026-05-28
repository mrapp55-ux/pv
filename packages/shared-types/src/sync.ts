export type SyncProvider = 'dropbox' | 'gdrive';
export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'error';

export interface SyncState {
  provider: SyncProvider;
  lastRevision: string | null;
  lastSyncAt: number | null;
  status: SyncStatus;
}

export interface SyncLogEntry {
  id: number;
  entryId: string;
  deviceId: string;
  seq: number;
  action: 'create' | 'update' | 'delete';
  timestamp: number;
}

export interface ConflictResult {
  resolved: boolean;
  /** Number of records where local won */
  localWins: number;
  /** Number of records where remote won */
  remoteWins: number;
}
