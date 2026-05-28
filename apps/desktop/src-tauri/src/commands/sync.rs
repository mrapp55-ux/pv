use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::error::{Result, VaultError};

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    vault_folder: Option<String>,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PasswordVault")
        .join("config.json")
}

fn read_config() -> Config {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(cfg: &Config) -> Result<()> {
    let path = config_path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| VaultError::Other(e.to_string()))?;
    std::fs::write(&path, json)?;
    Ok(())
}

/// The vault.db path — uses configured folder or falls back to %LOCALAPPDATA%\PasswordVault\.
pub fn vault_path() -> PathBuf {
    match read_config().vault_folder {
        Some(f) => PathBuf::from(f).join("vault.db"),
        None => dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("PasswordVault")
            .join("vault.db"),
    }
}

/// The vault.salt path (always sibling of vault.db).
pub fn salt_path() -> PathBuf {
    vault_path().with_extension("salt")
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_get_vault_folder() -> Option<String> {
    read_config().vault_folder
}

#[tauri::command]
pub fn cmd_set_vault_folder(folder: String) -> Result<()> {
    let path = PathBuf::from(&folder);
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    let mut cfg = read_config();
    cfg.vault_folder = Some(folder);
    write_config(&cfg)
}

/// Move vault.db + vault.salt to a new folder while the vault is open.
/// The caller must close the DB before calling this, then reopen from the new path.
#[tauri::command]
pub fn cmd_move_vault(new_folder: String) -> Result<()> {
    let new_dir = PathBuf::from(&new_folder);
    std::fs::create_dir_all(&new_dir)?;

    let old_db = vault_path();
    let old_salt = salt_path();

    // Update config first so vault_path() now points to new location
    let mut cfg = read_config();
    cfg.vault_folder = Some(new_folder);
    write_config(&cfg)?;

    let new_db = vault_path();
    let new_salt = salt_path();

    if old_db.exists() && old_db != new_db {
        std::fs::copy(&old_db, &new_db)?;
        std::fs::remove_file(&old_db)?;
    }
    if old_salt.exists() && old_salt != new_salt {
        std::fs::copy(&old_salt, &new_salt)?;
        std::fs::remove_file(&old_salt)?;
    }

    Ok(())
}

/// Try to find the Google Drive root (My Drive folder) on the current machine.
#[tauri::command]
pub fn cmd_detect_google_drive() -> Option<String> {
    detect_google_drive_root().map(|p| p.to_string_lossy().into_owned())
}

fn detect_google_drive_root() -> Option<PathBuf> {
    // Windows: check registry, then scan drive letters
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // Google Drive for Desktop (v85+)
        if let Ok(key) = hkcu.open_subkey("Software\\Google\\DriveFS") {
            for name in &["DefaultRootPath", "ShareDir"] {
                if let Ok(val) = key.get_value::<String, _>(name) {
                    let p = PathBuf::from(&val);
                    if p.exists() { return Some(p); }
                }
            }
        }
        // Scan all drive letters for a mounted "My Drive" folder
        for letter in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\My Drive", letter as char));
            if p.exists() { return Some(p); }
        }
    }

    // macOS: CloudStorage (newer) or legacy path
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        // Google Drive for Desktop on macOS
        if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) {
            for e in entries.flatten() {
                let name = e.file_name();
                let n = name.to_string_lossy();
                if n.starts_with("GoogleDrive") {
                    let p = e.path().join("My Drive");
                    if p.exists() { return Some(p); }
                }
            }
        }
        let legacy = home.join("Google Drive/My Drive");
        if legacy.exists() { return Some(legacy); }
    }

    // Linux: common mount paths
    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        for candidate in &["Google Drive/My Drive", "GoogleDrive/My Drive"] {
            let p = home.join(candidate);
            if p.exists() { return Some(p); }
        }
    }

    None
}
