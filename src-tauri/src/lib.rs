use tauri::Manager;

/// Allow the frontend to register an additional directory in the asset protocol scope.
/// Needed when the user configures a custom data path — the default path is pre-registered
/// at startup, but custom paths must be registered dynamically.
#[tauri::command]
fn allow_asset_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(std::path::Path::new(&path), true)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![allow_asset_directory]);

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Ok(dir) = app.path().app_local_data_dir() {
                    let travel_notes = dir.join("muse").join("travel_notes");
                    let _ = app.asset_protocol_scope().allow_directory(&travel_notes, true);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
