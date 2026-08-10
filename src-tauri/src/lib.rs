use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

const WEBVIEW_SUBDIR: &str = "EBWebView";
const WA_WINDOW_LABEL: &str = "whatsapp_web";

pub struct WhatsAppState {
    last_phone: Mutex<Option<String>>,
}

fn extract_phone(url: &str) -> Option<String> {
    url.split("phone=")
        .nth(1)?
        .split('&')
        .next()
        .map(|s| s.to_string())
}

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

#[tauri::command]
async fn show_whatsapp_web(
    app: tauri::AppHandle,
    url: String,
    state: State<'_, WhatsAppState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WA_WINDOW_LABEL) {
        let should_navigate = {
            let mut last = state.last_phone.lock().map_err(|e| e.to_string())?;
            let new_phone = extract_phone(&url);
            let old_phone = last.clone();
            let changed = new_phone != old_phone;
            if changed {
                *last = new_phone;
            }
            changed
        };

        if should_navigate {
            let safe = url.replace('\\', "\\\\").replace('\'', "\\'");
            window
                .eval(&format!("window.location.href = '{}';", safe))
                .map_err(|e| format!("navigate failed: {e}"))?;
        }

        window.show().map_err(|e| format!("show failed: {e}"))?;
        window.set_focus().map_err(|e| format!("focus failed: {e}"))?;
    } else {
        let local_data = app
            .path()
            .local_data_dir()
            .map_err(|e| format!("local_data_dir failed: {e}"))?;
        let webview_dir = local_data.join(WEBVIEW_SUBDIR);
        std::fs::create_dir_all(&webview_dir)
            .map_err(|e| format!("create_dir failed: {e}"))?;

        let wa_url = url
            .parse()
            .map_err(|e| format!("invalid url: {e}"))?;

        WebviewWindowBuilder::new(&app, WA_WINDOW_LABEL, WebviewUrl::External(wa_url))
            .title("WhatsApp Web")
            .inner_size(1024.0, 768.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .center()
            .visible(true)
            .data_directory(webview_dir)
            .build()
            .map_err(|e| format!("window build failed: {e}"))?;

        let mut last = state.last_phone.lock().map_err(|e| e.to_string())?;
        *last = extract_phone(&url);
    }
    Ok(())
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        let _ = window.close_devtools();
    } else {
        let _ = window.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WhatsAppState {
            last_phone: Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            copy_files_to_clipboard,
            show_whatsapp_web,
            toggle_devtools,
        ])
        .setup(|app| {
            let local_data = app.path().local_data_dir()?;
            let webview_dir = local_data.join(WEBVIEW_SUBDIR);
            std::fs::create_dir_all(&webview_dir).ok();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Smart Accountant")
                .inner_size(1280.0, 800.0)
                .resizable(true)
                .data_directory(webview_dir.clone())
                .build()?;

            if let Ok(wa_url) = "https://web.whatsapp.com".parse() {
                let _ = WebviewWindowBuilder::new(
                    app,
                    WA_WINDOW_LABEL,
                    WebviewUrl::External(wa_url),
                )
                .title("WhatsApp Web")
                .inner_size(1024.0, 768.0)
                .visible(false)
                .data_directory(webview_dir)
                .build();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label();
                if label == "main" {
                    window.app_handle().exit(0);
                } else if label == WA_WINDOW_LABEL {
                    let state = window.app_handle().state::<WhatsAppState>();
                    let _ = state.last_phone.lock().map(|mut last| {
                        *last = None;
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
