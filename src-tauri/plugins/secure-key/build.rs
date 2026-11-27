const COMMANDS: &[&str] = &["set_key", "get_key", "delete_key"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
