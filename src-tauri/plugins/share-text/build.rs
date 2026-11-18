const COMMANDS: &[&str] = &["share_text", "share_file", "share_files"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
