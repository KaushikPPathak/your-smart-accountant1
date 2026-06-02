import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;

export async function getDb() {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:smart_accountant.db');
  }
  return dbInstance;
}

export const nativeDb = {
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
