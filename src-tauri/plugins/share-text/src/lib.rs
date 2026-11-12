use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct ShareTextPayload {
    text: String,
}

#[cfg(target_os = "android")]
pub struct ShareHandle<R: Runtime>(PluginHandle<R>);

/// Opens WhatsApp (or the Android share sheet) with the given text.
#[tauri::command]
async fn share_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<ShareHandle<R>>();
        handle
            .0
            .run_mobile_plugin::<serde_json::Value>("shareText", ShareTextPayload { text })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, text);
        Err("share_text is only available on Android".into())
    }
}

/// Registers the share-text plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share-text")
        .invoke_handler(tauri::generate_handler![share_text])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.smartaccountant.sharetext", "SharePlugin")?;
                app.manage(ShareHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
