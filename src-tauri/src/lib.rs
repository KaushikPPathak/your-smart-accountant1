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

/// Put one or more absolute file paths on the OS clipboard as a native file
/// reference (CF_HDROP on Windows) so that pasting into WhatsApp / Explorer /
/// Outlook attaches the real file — not a bitmap render of it.
#[tauri::command]
fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no paths given".into());
    }

    #[cfg(windows)]
    {
        use clipboard_win::{raw::set_file_list, Clipboard};
        let _clip = Clipboard::new_attempts(10)
            .map_err(|e| format!("clipboard open failed: {e}"))?;
        set_file_list(&paths)
            .map_err(|e| format!("clipboard write failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err("file clipboard is only supported on Windows".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![copy_files_to_clipboard])
        .setup(|app| {
            // Resolve the OS local-data root and freeze the WebView profile
            // path underneath it. `local_data_dir()` already returns a
            // per-user, per-app path outside Program Files, so installer
            // upgrades never touch it.
            let local_data = app.path().local_data_dir()?;
            let webview_dir = local_data.join(WEBVIEW_SUBDIR);
            std::fs::create_dir_all(&webview_dir).ok();

            // Build the main window here (not in tauri.conf.json) so we can
            // guarantee it opens with the pinned data_directory.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Smart Accountant")
                .inner_size(1280.0, 800.0)
                .resizable(true)
                .data_directory(webview_dir.clone())
                .build()?;

            // Pre-warm WhatsApp Web in a hidden background window sharing
            // the exact same pinned data directory so session logins persist.
            if let Ok(wa_url) = "https://web.whatsapp.com".parse() {
                let _ = WebviewWindowBuilder::new(app, "whatsapp_web", WebviewUrl::External(wa_url))
                    .title("WhatsApp Web")
                    .inner_size(1024.0, 768.0)
                    .visible(false)
                    .data_directory(webview_dir)
                    .build();
            }

            Ok(())
        })
        // Clean exit: when the main window is closed, tear the whole process
        // down so no WebView/renderer child process is left dangling.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
