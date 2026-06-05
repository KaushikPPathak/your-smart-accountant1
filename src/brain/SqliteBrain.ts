let _db: any = null;
let _initPromise: Promise<any> | null = null;

// Combined schema definitions asserting both Mehtaji configurations and operational core accounting layouts
const SCHEMA_STATEMENTS: string[] = [
  // --- Mehtaji AI Engine Infrastructure ---
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

  // --- Core Offline Relational Schema (Fixes the company creation visibility break) ---
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gstin TEXT,
    pan TEXT,
    state TEXT,
    state_code TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS company_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT,
    user_id TEXT,
    role TEXT DEFAULT 'owner',
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  )`
];

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

/**
 * Creates a silent interface proxy for running inside standard browser previews
 */
function createMockDbInstance() {
  console.warn("Mehtaji Notice: Running outside Tauri desktop context. Activating offline volatile mock engine.");
  return {
    execute: async (sql: string, bind?: unknown[]) => {
      if (sql.toLowerCase().includes("select")) return [];
      return { rowsAffected: 0, lastInsertId: 0 };
    },
    select: async (sql: string, bind?: unknown[]) => [],
  };
}

export async function getBrainDb(): Promise<any> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Web safe handling fallback check
    if (!isTauriRuntime()) {
      _db = createMockDbInstance();
      return _db;
    }

    try {
      const Database = (await import("@tauri-apps/plugin-sql")).default;
      const db = await Database.load("sqlite:smart_accountant.db");
      for (const stmt of SCHEMA_STATEMENTS) {
        await db.execute(stmt);
      }
      _db = db;
      return db;
    } catch (criticalDbError) {
      console.error("Failed to initialize native engine stream:", criticalDbError);
      // Failover gracefully to dynamic mock object to avoid completely freezing root layout screens
      _db = createMockDbInstance();
      return _db;
    }
  })();

  return _initPromise;
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
  } catch (err) {
    console.error(`Select operation failed for query: ${sql}`, err);
    return [];
  }
}
