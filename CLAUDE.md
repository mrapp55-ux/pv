# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A cross-platform password manager. Mobile app (iOS + Android) built with Expo + React Native; desktop app (Tauri v2 + Rust) built in Phase 3. Data is stored in a SQLCipher-encrypted SQLite database and synced via Google Drive (zero-knowledge — cloud provider never sees plaintext).

## Commands

### Install dependencies
```sh
pnpm install
```
> **Required:** `.npmrc` sets `node-linker=hoisted`. This is mandatory — Google Drive does not support symlinks, which pnpm uses by default.

### Run all tests (workspace-wide)
```sh
pnpm test
```

### Run crypto unit tests only
```sh
pnpm --filter @vault/shared-crypto test
```

### Run a single test file
```sh
cd packages/shared-crypto && npx jest src/__tests__/aes-gcm.test.ts
```

### Type-check all packages
```sh
pnpm type-check
```

### Mobile app — start Expo dev server
```sh
pnpm --filter @vault/mobile start
```

### Mobile app — build for Android/iOS (requires native toolchain)
```sh
pnpm --filter @vault/mobile prebuild   # generates ios/ and android/ directories
pnpm --filter @vault/mobile android
pnpm --filter @vault/mobile ios        # macOS only
```

### Desktop app — dev mode (requires Rust toolchain)
```sh
pnpm --filter @vault/desktop tauri:dev
```
> **Windows prerequisites:** Rust (`rustup default stable`), Visual Studio 2022 Build Tools with the C++ workload (`winget install Microsoft.VisualStudio.2022.BuildTools`), and Strawberry Perl (`winget install StrawberryPerl.StrawberryPerl`) — required to compile OpenSSL from source for SQLCipher.

### Desktop app — production build
```sh
pnpm --filter @vault/desktop tauri:build
# Installer output: apps/desktop/src-tauri/target/release/bundle/
```

## Architecture

### Monorepo layout
```
packages/shared-types/    TypeScript interfaces (VaultEntry, SyncMetadata, etc.)
packages/shared-crypto/   Crypto primitives: Argon2id, AES-256-GCM, HKDF, key lifecycle
packages/shared-db/       SQLite schema DDL, parameterized query strings, migrations
packages/shared-ui/       Shared React/RN components
apps/mobile/              Expo + React Native app
apps/desktop/             Tauri v2 app (React/Vite frontend + Rust backend)
```

### Encryption architecture (critical to understand)

Two-layer encryption is used deliberately:

1. **SQLCipher** encrypts the entire `vault.db` file (AES-256-CBC + HMAC-SHA512). The 32-byte key must be set via `PRAGMA key = "x'<hex>'"` **before any other SQL**. `kdf_iter=1` is set because the key derivation is done externally by Argon2id — do not let SQLCipher run its own PBKDF2.

2. **AES-256-GCM field encryption** (second layer) on `password_enc`, `notes_enc`, and `security_questions_enc` columns. Per-field keys are derived via HKDF: `fieldKey = HKDF(masterKey, "field_enc:<fieldName>")`. This ensures metadata (title, username, URL) is readable once the DB is open, while passwords, notes, and security question answers get an extra authenticated-encryption layer.

### Key lifecycle

`packages/shared-crypto/src/key-manager.ts` owns the in-memory session:
- `initSession(password, salt)` — derives the 32-byte master key via Argon2id (Node.js path, used in tests)
- `initSessionFromKey(key)` — accepts a pre-derived key (used by biometric unlock and the mobile `keyDerivation.ts` service)
- `getMasterKey()` — returns the key for SQLCipher; throws if locked
- `getFieldKey(fieldName)` — HKDF-derives and caches per-field AES-256-GCM keys
- `lock()` — **zeroes** both the master key and all cached field keys via `Uint8Array.fill(0)`, then nulls the session

### Argon2id — platform split

The `argon2` npm package (native Node.js addon) is used in `packages/shared-crypto` **for tests only**. It cannot be bundled by Metro for React Native.

On mobile, key derivation goes through `apps/mobile/src/services/keyDerivation.ts`, which uses `react-native-argon2` and calls `initSessionFromKey()` with the result. The screens (`setup.tsx`, `unlock.tsx`) import from this service, not directly from `@vault/shared-crypto`.

On desktop, key derivation runs in Rust (`apps/desktop/src-tauri/src/commands/crypto.rs`) using the `argon2` crate.

Parameters: `m=65536` (64 MB), `t=3`, `p=4`, `hashLength=32`.

### Biometric unlock flow

**Mobile:** `apps/mobile/src/services/biometric.ts` — the 32-byte derived key is stored in the OS keychain (iOS Keychain / Android Keystore) via `react-native-keychain` with `ACCESS_CONTROL.BIOMETRY_CURRENT_SET`. This flag causes the stored key to be **invalidated** if the user enrolls a new face or fingerprint. On unlock, the OS biometric prompt returns the stored key, which is passed to `initSessionFromKey()`.

**Desktop:** `apps/desktop/src-tauri/src/commands/biometric.rs` — key stored in Windows Credential Manager / macOS Keychain via the `keyring` Rust crate. Windows Hello via `UserConsentVerifier` Windows Runtime API gated on biometric prompt before key retrieval.

Failure handling: 3 biometric failures → fall back to master password. 10 total master password failures → exponential lockout.

### Desktop app structure

```
apps/desktop/
  src/                          React/Vite frontend
    pages/SetupPage.tsx         First-time vault creation + vault location selection
    pages/UnlockPage.tsx        Password + Windows Hello unlock
    pages/VaultPage.tsx         Two-panel layout (entry list + detail/new/settings)
    pages/EntryDetailPanel.tsx  View/edit a single entry
    pages/NewEntryPanel.tsx     Create new entry
    services/tauri-bridge.ts    Typed IPC wrappers around Tauri invoke()
    store/vault.ts              Zustand auth + entry list state
  src-tauri/
    src/
      commands/crypto.rs        Argon2id, AES-256-GCM, HKDF, password generator
      commands/database.rs      SQLCipher open + CRUD operations
      commands/biometric.rs     OS keychain + Windows Hello
      commands/sync.rs          Vault path config, Google Drive detection
      commands/mod.rs           All Tauri command handlers
      state.rs                  AppState (Mutex<SessionKey> + Mutex<Connection>)
      error.rs                  VaultError enum + Tauri-serializable Result
```

### Desktop vault storage (sync)

The desktop app stores `vault.db` and `vault.salt` in a user-configurable folder. During setup, it auto-detects the Google Drive "My Drive" folder (Windows: registry scan + drive letter scan; macOS: `~/Library/CloudStorage/GoogleDrive*/My Drive`). The user can override via the Settings panel.

When the vault is stored in a Google Drive folder, the native Google Drive desktop client syncs `vault.db` and `vault.salt` to the cloud and to all other computers automatically — **no API calls are needed from the desktop app**.

Vault config is stored in `%APPDATA%\PasswordVault\config.json` with fields:
- `vault_folder` — absolute path for custom/local storage (null when using Google Drive mode)
- `use_google_drive` — when `true`, the drive letter is detected at runtime so it survives remounts to a different letter
- `auto_lock_minutes` — inactivity timeout (0 = disabled, default 5)

Key commands:
- `cmd_get_vault_location` — returns `VaultLocationInfo` (resolved folder, GDrive flag, GDrive availability)
- `cmd_set_use_google_drive(enabled)` — toggles Google Drive mode; clears `vault_folder` when enabled
- `cmd_set_vault_folder(folder)` — saves a custom path and sets `use_google_drive = false`
- `cmd_relocate_vault` — moves files to a new folder while the vault is open (closes DB, copies files, reopens)
- `cmd_get_auto_lock_minutes` / `cmd_set_auto_lock_minutes` — inactivity timeout setting
- `cmd_change_master_password(old, new)` — verifies old password, re-encrypts all entry fields in one SQLite transaction, rekeys the SQLCipher DB with `PRAGMA rekey`, updates the salt sidecar, and refreshes the in-memory session and keychain

### Mobile app routing

Expo Router (file-based) with two route groups:
- `(auth)/setup` — first-time vault creation OR "join existing vault from Google Drive"
- `(auth)/unlock` — subsequent unlocks (biometric + password fallback) + Drive sync on open
- `(vault)/` — entry list
- `(vault)/new` — create entry (triggers `syncAfterWrite()`)
- `(vault)/[id]` — view / edit / delete entry (triggers `syncAfterWrite()`)

The root `_layout.tsx` handles: screenshot prevention, Google Sign-In configuration, auth-state routing guard, and AppState-based auto-lock (60-second timer when app goes to background).

### Mobile sync (Google Drive API)

`apps/mobile/src/services/sync.ts` — Google Drive REST API v3.

**Sync flow:**
- On unlock: `syncOnOpen()` checks Drive for a newer `vault.db` (compares `modifiedTime` to cached timestamp). If newer, downloads `vault.db` + `vault.salt`, closes and reopens the DB.
- After any write: `syncAfterWrite()` fires in the background (non-blocking). Uploads `vault.db` and `vault.salt` to `My Drive/PasswordVault/`.
- On new device: setup screen offers "Join Existing Vault via Google Drive" — signs in, downloads vault, prompts for master password to verify.

**Google OAuth setup required** (see `apps/mobile/src/config/googleAuth.ts`):
1. Google Cloud project with Drive API enabled
2. OAuth 2.0 credentials (web + iOS/Android client IDs)
3. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `.env`
4. Drive scope: `https://www.googleapis.com/auth/drive.file`

Sync is **optional** — if `GOOGLE_WEB_CLIENT_ID` is empty or the user is not signed in, the app works fully offline.

### State management

`apps/mobile/src/store/vault.ts` — a single Zustand store with `authState` (`'loading' | 'setup' | 'locked' | 'unlocked'`), the entry list (metadata only, never decrypted passwords), and `deviceId`.

### Database queries

All SQL lives in `packages/shared-db/src/queries.ts` as the `Q` object. Never interpolate user data — always use parameterized queries. The driver (`@op-engineering/op-sqlite`) is called in `apps/mobile/src/services/database.ts`.

`listEntries()` intentionally does **not** decrypt — it returns title/username/URL only. `getEntry(id)` decrypts on-demand for the detail screen. This avoids decrypting the entire vault into memory.

### Schema versioning

`PRAGMA user_version` tracks the schema version. `packages/shared-db/src/migrations.ts` exports an ordered array of `Migration` objects. Add new migrations at the **end** of the array — never edit existing ones.

## Security invariants — do not break

- The PRAGMA sequence in `openDatabase()` must not be reordered. `PRAGMA key` must be the first statement.
- `kdf_iter = 1` must remain set — SQLCipher must not run its own key derivation on top of Argon2id.
- All deletes must be soft-deletes (`deleted_at` timestamp). Hard-deletes break sync conflict resolution.
- Never log or stringify a `VaultEntry.password` field. The entry detail screen disables `selectable` on the masked password display.
- `lock()` must be called before nulling the DB handle. Key zeroing is best-effort in JS; the important guarantee is that the SQLCipher connection is closed.
- Clipboard copies use `copySecure()` from `services/clipboard.ts`, which schedules a 30-second auto-clear. Do not call `Clipboard.setString()` directly for sensitive values.
- Desktop: `Zeroizing<[u8; 32]>` in Rust automatically zeroes key bytes on drop. Never copy a `SessionKey` — pass references. `SessionKey` holds 4 derived keys: `master`, `field_password`, `field_notes`, `field_security_questions`.
- The `vault.salt` sidecar file is NOT secret (the salt only needs to be unique, not confidential). It is safe for it to be stored in Google Drive alongside the encrypted DB.
