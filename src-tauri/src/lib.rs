use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Define initial SQL schemas for your core accounting data
    let migrations = vec![
        Migration {
            version: 1,
            description: "initialize_accounting_tables",
            sql: "CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
                  CREATE TABLE IF NOT EXISTS ledgers (id TEXT PRIMARY KEY, company_id TEXT, name TEXT NOT NULL, category TEXT, created_at TEXT);
                  CREATE TABLE IF NOT EXISTS vouchers (id TEXT PRIMARY KEY, company_id TEXT, voucher_type TEXT, date TEXT, narration TEXT, created_at TEXT);
                  CREATE TABLE IF NOT EXISTS voucher_entries (id TEXT PRIMARY KEY, voucher_id TEXT, ledger_id TEXT, debit REAL, credit REAL);",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                // The migration key MUST match the db connection URL used by Database.load() on the JS side
                .add_migrations("sqlite:smart_accountant.db", migrations)
                .build()
        )
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
