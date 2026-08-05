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

/// Show or recreate the WhatsApp Web window and navigate to the given URL.
/// If the window already exists (even if hidden), it is shown, focused, and
/// navigated to the target chat. If the user closed it, it is recreated with
/// the pinned data directory so the QR-code login persists forever.
#[tauri::command]
async fn show_whatsapp_web(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("whatsapp_web") {
        // Navigate using eval — keeps the existing WebView2 session alive
        let script = format!("window.location.href = '{}';", url.replace("'", "\\'"));
        window.eval(&script).map_err(|e| format!("navigate failed: {e}"))?;
        window.show().map_err(|e| format!("show failed: {e}"))?;
        window.set_focus().map_err(|e| format!("focus failed: {e}"))?;
    } else {
        // User closed the window — recreate it with the same pinned profile
        let local_data = app.path().local_data_dir()
            .map_err(|e| format!("local_data_dir failed: {e}"))?;
        let webview_dir = local_data.join(WEBVIEW_SUBDIR);
        std::fs::create_dir_all(&webview_dir)
            .map_err(|e| format!("create_dir failed: {e}"))?;

        let wa_url = url.parse()
            .map_err(|e| format!("invalid url: {e}"))?;

        WebviewWindowBuilder::new(&app, "whatsapp_web", WebviewUrl::External(wa_url))
            .title("WhatsApp Web")
            .inner_size(1024.0, 768.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .center()
            .visible(true)
            .data_directory(webview_dir)
            .build()
            .map_err(|e| format!("window build failed: {e}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            copy_files_to_clipboard,
            show_whatsapp_web,
        ])
        .setup(|app| {
            // Resolve the OS local-data root and freeze the WebView profile
            // path underneath it.
            let local_data = app.path().local_data_dir()?;
            let webview_dir = local_data.join(WEBVIEW_SUBDIR);
            std::fs::create_dir_all(&webview_dir).ok();

            // Build the main window with the pinned data_directory
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
