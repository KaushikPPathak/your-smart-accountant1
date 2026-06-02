import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;

export async function getDb() {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:smart_accountant.db');
    
    // Auto-create the local users table on launch if it does not exist yet
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }
  return dbInstance;
}

export const nativeDb = {
  // ==========================================
  // 🔐 LOCAL OFFLINE AUTHENTICATION METHODS
  // ==========================================
  
  // Direct local offline signup
  async registerLocalUser(email: string, passwordHash: string) {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    try {
      await db.execute(
        "INSERT INTO local_users (id, email, password, created_at) VALUES ($1, $2, $3, $4)",
        [id, email, passwordHash, now]
      );
      return { success: true, user: { id, email } };
    } catch (error) {
      return { success: false, error: "This email is already registered on this PC." };
    }
  },

  // Direct local offline login
  async loginLocalUser(email: string, passwordHash: string) {
    const db = await getDb();
    const users = await db.select<Array<{ id: string; email: string; created_at: string }>>(
      "SELECT id, email, created_at FROM local_users WHERE email = $1 AND password = $2",
      [email, passwordHash]
    );

    if (users.length > 0) {
      return { success: true, user: users[0] };
    } else {
      return { success: false, error: "Invalid local email or password." };
    }
  },

  // ==========================================
  // 🏢 LOCAL COMPANY MANAGER METHODS
  // ==========================================

  // Direct local company insertion
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

  // Direct local company fetching
  async getCompanies() {
    const db = await getDb();
    return await db.select<Array<{ id: string; name: string; created_at: string }>>(
      "SELECT * FROM companies ORDER BY created_at DESC"
    );
  }
};
