import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;
let schemaReady = false;

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export async function getDb() {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:smart_accountant.db');
  }
  if (!schemaReady) {
    // Base table (legacy email-based shape kept for backward compat).
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY,
        email TEXT,
        password TEXT,
        created_at TEXT NOT NULL
      )
    `);
    // Best-effort additive columns for richer offline identity.
    const adds = [
      "ALTER TABLE local_users ADD COLUMN username TEXT",
      "ALTER TABLE local_users ADD COLUMN name TEXT",
      "ALTER TABLE local_users ADD COLUMN role TEXT",
      "ALTER TABLE local_users ADD COLUMN password_hash TEXT",
      "ALTER TABLE local_users ADD COLUMN is_active INTEGER DEFAULT 1",
      "ALTER TABLE local_users ADD COLUMN updated_at TEXT",
    ];
    for (const sql of adds) {
      try { await dbInstance.execute(sql); } catch { /* column exists */ }
    }
    try {
      await dbInstance.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_local_users_username ON local_users(username)"
      );
    } catch { /* ignore */ }
    schemaReady = true;
  }
  return dbInstance;
}

export interface LocalUserIdentity {
  id: string;
  username: string;
  name: string;
  role: string;
  passwordHash: string;
  isActive?: boolean;
}

export const nativeDb = {
  // ==========================================
  // 🔐 LOCAL OFFLINE AUTHENTICATION METHODS
  // ==========================================

  // Insert OR update a local user by username. Prevents duplicates by
  // matching the cloud user id when it already exists locally.
  async upsertLocalUser(identity: LocalUserIdentity) {
    const db = await getDb();
    const now = new Date().toISOString();
    const uname = identity.username.trim().toLowerCase();

    const existing = await db.select<Array<{ id: string }>>(
      "SELECT id FROM local_users WHERE id = $1 OR username = $2 LIMIT 1",
      [identity.id, uname]
    );

    if (existing.length > 0) {
      await db.execute(
        `UPDATE local_users
           SET username = $1, name = $2, role = $3, password_hash = $4,
               is_active = $5, updated_at = $6, password = $4, email = COALESCE(email, $1)
         WHERE id = $7 OR username = $1`,
        [
          uname,
          identity.name,
          identity.role,
          identity.passwordHash,
          identity.isActive === false ? 0 : 1,
          now,
          identity.id,
        ]
      );
      return { success: true, updated: true, user: { id: identity.id, username: uname } };
    }

    await db.execute(
      `INSERT INTO local_users
         (id, email, password, created_at, username, name, role, password_hash, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $2, $5, $6, $3, 1, $4)`,
      [identity.id, uname, identity.passwordHash, now, identity.name, identity.role]
    );
    return { success: true, updated: false, user: { id: identity.id, username: uname } };
  },

  async getLocalUserByUsername(username: string) {
    const db = await getDb();
    const uname = username.trim().toLowerCase();
    const rows = await db.select<Array<{
      id: string; username: string; name: string; role: string;
      password_hash: string; is_active: number;
    }>>(
      `SELECT id, username, name, role, password_hash, is_active
         FROM local_users
        WHERE username = $1 OR email = $1
        LIMIT 1`,
      [uname]
    );
    return rows[0] ?? null;
  },

  // Legacy email-based register (kept for compatibility with older callers).
  async registerLocalUser(email: string, passwordHash: string) {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.execute(
        `INSERT INTO local_users (id, email, password, created_at, username, password_hash, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $2, $3, 1, $4)`,
        [id, email, passwordHash, now]
      );
      return { success: true, user: { id, email } };
    } catch (error) {
      return { success: false, error: "This email is already registered on this PC." };
    }
  },

  async loginLocalUser(email: string, passwordHash: string) {
    const db = await getDb();
    const users = await db.select<Array<{ id: string; email: string; created_at: string }>>(
      "SELECT id, email, created_at FROM local_users WHERE email = $1 AND password = $2",
      [email, passwordHash]
    );
    if (users.length > 0) return { success: true, user: users[0] };
    return { success: false, error: "Invalid local email or password." };
  },

  // ==========================================
  // 🏢 LOCAL COMPANY MANAGER METHODS
  // ==========================================

  async createCompany(name: string) {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3)",
      [id, name, now]
    );
    return { id, name };
  },

  async getCompanies() {
    const db = await getDb();
    return await db.select<Array<{ id: string; name: string; created_at: string }>>(
      "SELECT * FROM companies ORDER BY created_at DESC"
    );
  }
};
