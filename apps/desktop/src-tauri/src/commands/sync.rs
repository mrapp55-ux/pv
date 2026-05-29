use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::error::{Result, VaultError};

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    vault_folder: Option<String>,
    use_google_drive: Option<bool>,
    auto_lock_minutes: Option<u32>,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PV")
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

fn normalize_path(p: &str) -> String {
    p.replace('/', std::path::MAIN_SEPARATOR_STR)
}

/// Resolve the vault folder: Google Drive detection when flagged, else stored path, else local default.
fn resolve_vault_folder() -> PathBuf {
    let cfg = read_config();
    if cfg.use_google_drive.unwrap_or(false) {
        if let Some(root) = detect_google_drive_root() {
            return root.join("PV");
        }
        // Google Drive not found — fall through to local default
    }
    match cfg.vault_folder {
        Some(f) => PathBuf::from(normalize_path(&f)),
        None => dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("PV"),
    }
}

pub fn vault_path() -> PathBuf {
    resolve_vault_folder().join("vault.db")
}

pub fn salt_path() -> PathBuf {
    vault_path().with_extension("salt")
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct VaultLocationInfo {
    pub use_google_drive: bool,
    pub resolved_folder: String,
    pub google_drive_available: bool,
    pub google_drive_folder: Option<String>,
}

#[tauri::command]
pub fn cmd_get_vault_location() -> VaultLocationInfo {
    let cfg = read_config();
    let use_google_drive = cfg.use_google_drive.unwrap_or(false);
    let gd_folder = detect_google_drive_root()
        .map(|p| p.join("PV").to_string_lossy().to_string())
        .map(|s| normalize_path(&s));
    let google_drive_available = gd_folder.is_some();
    let resolved_folder = normalize_path(&resolve_vault_folder().to_string_lossy());
    VaultLocationInfo { use_google_drive, resolved_folder, google_drive_available, google_drive_folder: gd_folder }
}

/// Switch to Google Drive mode (auto-detects drive letter at runtime) or back to local/custom.
/// Does NOT move files — use cmd_relocate_vault beforehand if needed.
#[tauri::command]
pub fn cmd_set_use_google_drive(enabled: bool) -> Result<()> {
    let mut cfg = read_config();
    cfg.use_google_drive = Some(enabled);
    if enabled { cfg.vault_folder = None; } // path is resolved dynamically
    write_config(&cfg)
}

/// Legacy getter kept for compatibility.
#[tauri::command]
pub fn cmd_get_vault_folder() -> Option<String> {
    let cfg = read_config();
    if cfg.use_google_drive.unwrap_or(false) { return None; }
    cfg.vault_folder
}

#[tauri::command]
pub fn cmd_set_vault_folder(folder: String) -> Result<()> {
    let normalized = normalize_path(&folder);
    let path = PathBuf::from(&normalized);
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    let mut cfg = read_config();
    cfg.vault_folder = Some(normalized);
    cfg.use_google_drive = Some(false);
    write_config(&cfg)
}

/// Move vault.db + vault.salt to a new folder while the vault is open.
#[tauri::command]
pub fn cmd_move_vault(new_folder: String) -> Result<()> {
    let normalized = normalize_path(&new_folder);
    let new_dir = PathBuf::from(&normalized);
    std::fs::create_dir_all(&new_dir)?;

    let old_db = vault_path();
    let old_salt = salt_path();

    let mut cfg = read_config();
    cfg.vault_folder = Some(normalized);
    cfg.use_google_drive = Some(false);
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

/// Get auto-lock timeout in minutes (0 = disabled). Default is 5.
#[tauri::command]
pub fn cmd_get_auto_lock_minutes() -> u32 {
    read_config().auto_lock_minutes.unwrap_or(5)
}

/// Persist the auto-lock timeout (0 = disabled).
#[tauri::command]
pub fn cmd_set_auto_lock_minutes(minutes: u32) -> Result<()> {
    let mut cfg = read_config();
    cfg.auto_lock_minutes = Some(minutes);
    write_config(&cfg)
}

/// Try to find the Google Drive root (My Drive folder) on the current machine.
#[tauri::command]
pub fn cmd_detect_google_drive() -> Option<String> {
    detect_google_drive_root()
        .map(|p| normalize_path(&p.to_string_lossy()))
}

fn detect_google_drive_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\Google\\DriveFS") {
            for name in &["DefaultRootPath", "ShareDir"] {
                if let Ok(val) = key.get_value::<String, _>(name) {
                    let p = PathBuf::from(&val);
                    if p.exists() { return Some(p); }
                }
            }
        }
        for letter in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\My Drive", letter as char));
            if p.exists() { return Some(p); }
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) {
            for e in entries.flatten() {
                let name = e.file_name();
                if name.to_string_lossy().starts_with("GoogleDrive") {
                    let p = e.path().join("My Drive");
                    if p.exists() { return Some(p); }
                }
            }
        }
        let legacy = home.join("Google Drive/My Drive");
        if legacy.exists() { return Some(legacy); }
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        for candidate in &["Google Drive/My Drive", "GoogleDrive/My Drive"] {
            let p = home.join(candidate);
            if p.exists() { return Some(p); }
        }
    }

    None
}
