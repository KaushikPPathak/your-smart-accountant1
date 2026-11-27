use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
pub struct SecureKeyHandle<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct IdPayload {
    company_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct SetPayload {
    company_id: String,
    key_base64: String,
}

fn validate_id(company_id: &str) -> Result<(), String> {
    if company_id.is_empty()
        || company_id.len() > 64
        || !company_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid company id".into());
    }
    Ok(())
}

/// Stores a company key, wrapped by a hardware-backed Android Keystore key.
#[tauri::command]
async fn set_key<R: Runtime>(app: AppHandle<R>, company_id: String, key_base64: String) -> Result<(), String> {
    validate_id(&company_id)?;
    if key_base64.len() > 128 {
        return Err("Key is too long".into());
    }
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<SecureKeyHandle<R>>();
        handle
            .0
            .run_mobile_plugin::<serde_json::Value>("setKey", SetPayload { company_id, key_base64 })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, company_id, key_base64);
        Err("Secure key storage on this phone is only available on Android".into())
    }
}

/// Reads a company key, or None if there is none.
#[tauri::command]
async fn get_key<R: Runtime>(app: AppHandle<R>, company_id: String) -> Result<Option<String>, String> {
    validate_id(&company_id)?;
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<SecureKeyHandle<R>>();
        let v = handle
            .0
            .run_mobile_plugin::<serde_json::Value>("getKey", IdPayload { company_id })
            .map_err(|e| e.to_string())?;
        Ok(v.get("value").and_then(|x| x.as_str()).map(|s| s.to_string()))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, company_id);
        Err("Secure key storage on this phone is only available on Android".into())
    }
}

/// Removes a company key from this phone.
#[tauri::command]
async fn delete_key<R: Runtime>(app: AppHandle<R>, company_id: String) -> Result<(), String> {
    validate_id(&company_id)?;
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<SecureKeyHandle<R>>();
        handle
            .0
            .run_mobile_plugin::<serde_json::Value>("deleteKey", IdPayload { company_id })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, company_id);
        Err("Secure key storage on this phone is only available on Android".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-key")
        .invoke_handler(tauri::generate_handler![set_key, get_key, delete_key])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.smartaccountant.securekey", "SecureKeyPlugin")?;
                app.manage(SecureKeyHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
