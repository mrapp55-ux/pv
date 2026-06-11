mod commands;
mod error;
mod state;

use commands::*;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Auth
            cmd_is_vault_initialized,
            cmd_is_unlocked,
            cmd_is_biometric_available,
            cmd_initialize_vault,
            cmd_unlock_vault,
            cmd_unlock_biometric,
            cmd_lock,
            cmd_delete_vault,
            cmd_enable_biometric,
            cmd_disable_biometric,
            // Vault CRUD
            cmd_list_entries,
            cmd_get_entry,
            cmd_create_entry,
            cmd_update_entry,
            cmd_delete_entry,
            cmd_generate_password,
            // Groups
            cmd_list_groups,
            cmd_create_group,
            cmd_rename_group,
            cmd_delete_group,
            // Sync / vault location
            cmd_get_vault_folder,
            cmd_set_vault_folder,
            cmd_move_vault,
            cmd_relocate_vault,
            cmd_detect_google_drive,
            cmd_get_vault_location,
            cmd_set_use_google_drive,
            cmd_get_auto_lock_seconds,
            cmd_set_auto_lock_seconds,
            cmd_change_master_password,
            cmd_write_file,
            cmd_backup_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
