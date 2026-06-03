import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;
let _initPromise: Promise<Database> | null = null;

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS brain_error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    error_code TEXT,
    error_message TEXT,
    component TEXT,
    action_attempted TEXT,
    auto_fixed INTEGER DEFAULT 0,
    fix_applied TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS brain_cache (
    cache_key TEXT PRIMARY KEY,
    cache_value TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS brain_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS brain_command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_text TEXT,
    matched_action TEXT,
    executed_at TEXT
  )`,
];

export async function getBrainDb(): Promise<Database> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await Database.load("sqlite:smart_accountant.db");
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.execute(stmt);
    }
    _db = db;
    return db;
  })();

  return _initPromise;
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export async function safeBrainExec(
  sql: string,
  bindings: unknown[] = [],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getBrainDb();
    await db.execute(sql, bindings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function safeBrainSelect<T = unknown>(
  sql: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  try {
    const db = await getBrainDb();
    return await db.select<T[]>(sql, bindings);
  } catch {
    return [];
  }
}
