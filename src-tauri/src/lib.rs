// Tauri entry. Two invariants live here — do NOT change without a migration plan:
//
// 1. The app identifier in tauri.conf.json is frozen at `com.smartaccountant.app`.
//    Changing it moves the OS-standard data folder and orphans every user's data.
//
// 2. The WebView2 user-data directory is PINNED to a fixed absolute path
//    (`%LOCALAPPDATA%\com.smartaccountant.app\EBWebView\` on Windows, the
//    equivalent under `~/Library/Application Support` on macOS, and
//    `~/.local/share` on Linux). This is the folder that holds the IndexedDB
//    where every company, voucher, ledger, item and setting lives.
//
//    Tauri's default is a path derived from the runtime identity; if ANY of
//    the identifier / install location / user profile / WebView2 version
//    changes, WebView2 opens a brand-new empty profile and the previous
//    IndexedDB becomes orphaned. Pinning here freezes the location forever
//    so installer upgrades and auto-updates can never separate the app from
//    its live data.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const WEBVIEW_SUBDIR: &str = "EBWebView";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Resolve the OS local-data root and freeze the WebView profile
            // path underneath it. `local_data_dir()` already returns a
            // per-user, per-app path outside Program Files, so installer
            // upgrades never touch it.
            let local_data = app.path().local_data_dir()?;
            let webview_dir = local_data.join(WEBVIEW_SUBDIR);
            std::fs::create_dir_all(&webview_dir).ok();

            // Replace the config-declared window with one that has the
            // pinned data_directory. Closing + rebuilding keeps title,
            // size and behaviour identical while guaranteeing every future
            // launch reads IndexedDB from the same folder.
            if let Some(existing) = app.get_webview_window("main") {
                let _ = existing.close();
            }
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Smart Accountant")
                .inner_size(1280.0, 800.0)
                .resizable(true)
                .data_directory(webview_dir)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
