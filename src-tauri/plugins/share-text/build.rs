const COMMANDS: &[&str] = &["share_text", "share_file", "share_files", "open_file", "save_to_downloads"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
