use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const WEBVIEW_SUBDIR: &str = "EBWebView";
const WA_WINDOW_LABEL: &str = "whatsapp_web";
const OAUTH_WINDOW_LABEL: &str = "oauth_signin";

/// True when the provider is redirecting back to our cloud-backup callback.
/// The redirect target never has to exist — we intercept the navigation.
fn is_oauth_callback(url: &tauri::Url) -> bool {
    let host_ok = matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost")
    );
    host_ok && url.path() == "/oauth-callback"
}

/// Opens the provider sign-in page in its own app window (window.open is
/// unavailable inside the desktop shell, which caused "Popup blocked").
/// When the provider redirects to /oauth-callback, the URL is sent to the
/// main window as an `oauth-callback` event and the window closes.
#[tauri::command]
async fn start_oauth_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let target: tauri::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;

    if let Some(existing) = app.get_webview_window(OAUTH_WINDOW_LABEL) {
        existing
            .navigate(target)
            .map_err(|e| format!("navigate failed: {e}"))?;
        existing.show().ok();
        existing.set_focus().ok();
        return Ok(());
    }

    let local_data = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("local_data_dir failed: {e}"))?;
    let webview_dir = local_data.join(WEBVIEW_SUBDIR);
    std::fs::create_dir_all(&webview_dir).map_err(|e| format!("create_dir failed: {e}"))?;

    let handle = app.clone();
    let builder = centered(
        WebviewWindowBuilder::new(&app, OAUTH_WINDOW_LABEL, WebviewUrl::External(target))
            .title("Sign in for cloud backup")
            .inner_size(560.0, 720.0)
            .resizable(true),
    );
    builder
        .visible(true)
        .data_directory(webview_dir)
        .on_navigation(move |nav_url| {
            if is_oauth_callback(nav_url) {
                let _ = handle.emit("oauth-callback", nav_url.to_string());
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(w) = h.get_webview_window(OAUTH_WINDOW_LABEL) {
                        let _ = w.close();
                    }
                });
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("window build failed: {e}"))?;
    Ok(())
}

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

/// Terminates the whole desktop process (main window + hidden WhatsApp
/// window). Used by the "Exit Software" confirmation.
// ── Sync encryption keys ────────────────────────────────────────────────
// One AES-256 key per company, stored in Windows Credential Manager under
// service "SmartAccountant.sync". The key is never written to a file and
// never leaves the device except through the pairing flow.
const SYNC_KEY_SERVICE: &str = "SmartAccountant.sync";

#[cfg(windows)]
fn sync_key_entry(company_id: &str) -> Result<keyring::Entry, String> {
    if company_id.is_empty()
        || company_id.len() > 64
        || !company_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid company id".into());
    }
    keyring::Entry::new(SYNC_KEY_SERVICE, company_id).map_err(|e| e.to_string())
}

/// Returns the stored base64 key for a company, or None if there is none.
#[tauri::command]
fn sync_key_get(company_id: String) -> Result<Option<String>, String> {
    let entry = sync_key_entry(&company_id)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Stores a base64 key for a company. Overwrites any existing key.
#[tauri::command]
fn sync_key_set(company_id: String, key_base64: String) -> Result<(), String> {
    if key_base64.len() > 128 {
        return Err("Key is too long".into());
    }
    sync_key_entry(&company_id)?
        .set_password(&key_base64)
        .map_err(|e| e.to_string())
}

/// Removes a company key from this device.
#[tauri::command]
fn sync_key_delete(company_id: String) -> Result<(), String> {
    match sync_key_entry(&company_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Non-Windows builds have no keychain binding yet (Android uses its own
// Keystore path). Every call fails closed instead of storing keys in plain text.
#[cfg(not(windows))]
#[tauri::command]
fn sync_key_get(company_id: String) -> Result<Option<String>, String> {
    let _ = (&company_id, SYNC_KEY_SERVICE);
    Err("Secure key storage is not available on this platform".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn sync_key_set(company_id: String, key_base64: String) -> Result<(), String> {
    let _ = (&company_id, &key_base64);
    Err("Secure key storage is not available on this platform".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn sync_key_delete(company_id: String) -> Result<(), String> {
    let _ = &company_id;
    Err("Secure key storage is not available on this platform".into())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
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

        let builder = centered(
            WebviewWindowBuilder::new(&app, WA_WINDOW_LABEL, WebviewUrl::External(wa_url))
                .title("WhatsApp Web")
                .inner_size(1024.0, 768.0)
                .min_inner_size(800.0, 600.0)
                .resizable(true),
        );
        builder
            .visible(true)
            .data_directory(webview_dir)
            .build()
            .map_err(|e| format!("window build failed: {e}"))?;

        let mut last = state.last_phone.lock().map_err(|e| e.to_string())?;
        *last = extract_phone(&url);
    }
    Ok(())
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_share_text::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            copy_files_to_clipboard,
            show_whatsapp_web,
            start_oauth_window,
            exit_app,
            sync_key_get,
            sync_key_set,
            sync_key_delete,
        ])
        .setup(|app| {
            let local_data = app.path().local_data_dir()?;
            let webview_dir = local_data.join(WEBVIEW_SUBDIR);
            std::fs::create_dir_all(&webview_dir).ok();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Smart Accountant")
                .inner_size(1280.0, 800.0)
                .resizable(true)
                .data_directory(webview_dir)
                .build()?;

            // WhatsApp Web is NOT pre-loaded at startup: it competed with the
            // main window for CPU, disk and network during launch. The window
            // is created on first use by `show_whatsapp_web`.


            Ok(())
        })
        .on_window_event(|window, event| {
    if let tauri::WindowEvent::Destroyed = event {
        let label = window.label();
        if label == "main" {
            window.app_handle().exit(0);
        } else if label == OAUTH_WINDOW_LABEL {
            let _ = window.app_handle().emit("oauth-closed", ());
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

/// Centres a new window on desktop. Android has no positioning for extra windows,
/// and the builder method is not compiled there, so it is skipped on Android.
#[cfg(not(target_os = "android"))]
fn centered<'a>(
    b: WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    b.center()
}

#[cfg(target_os = "android")]
fn centered<'a>(
    b: WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    b
}
