// Local login accounts for the offline build.
//
// Accounts are created on this device (createLocalAccount) and stored with a
// bcrypt hash. Login checks the password against that hash
// (verifyOfflineLogin). No server is contacted at any point.
//
// SECURITY: only a bcrypt hash is stored, never the plaintext password.

import bcrypt from "bcryptjs";

export interface AccountCredCacheRow {
  username: string;
  user_id: string;
  name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
  /** Hidden accounts are left out of the login dropdown; the user types the ID. */
  hidden?: boolean;
  cached_at: number;
}

// Dynamically resolve the offline database instance to avoid top-level bundler collision
async function getOfflineDb() {
  const module = await import("./db");
  return module.default || module.offlineDb || (module as any).db;
}

const LOCKOUT_KEY = "ym_local_lock_until";
const ATTEMPTS_KEY = "ym_local_lock_attempts";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

async function persistLocalUserNative(
  identity: { id: string; username: string; name: string; role: string; isActive: boolean },
  passwordHash: string,
): Promise<void> {
  try {
    const { isTauri, nativeDb } = await import("@/utils/nativeDb");
    if (!isTauri()) return;
    const result = await nativeDb.upsertLocalUser({
      id: identity.id,
      username: identity.username,
      name: identity.name,
      role: identity.role,
      passwordHash,
      isActive: identity.isActive,
    });
    console.log(
      `✅ Local user registration success (${result.updated ? "updated" : "inserted"}):`,
      identity.username,
    );
  } catch (err) {
    console.error("❌ Local user registration failure:", err);
  }
}

export interface NewLocalAccount {
  name: string;
  username: string;
  password: string;
  role: string;
  hidden: boolean;
}

export interface OfflineLoginResult {
  id: string;
  name: string;
  role: string;
}

/** Create an account on this device. Fails if the user ID is already used here. */
export async function createLocalAccount(input: NewLocalAccount): Promise<OfflineLoginResult> {
  const uname = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const offlineDb = await getOfflineDb();
  const existing = await offlineDb.account_creds.get(uname);
  if (existing) throw new Error("That user ID already exists on this device.");

  const id =
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `acct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const passwordHash = await bcrypt.hash(input.password, 10);
  const row: AccountCredCacheRow = {
    username: uname,
    user_id: id,
    name,
    role: input.role,
    password_hash: passwordHash,
    is_active: true,
    hidden: input.hidden,
    cached_at: Date.now(),
  };
  await offlineDb.account_creds.put(row);
  await persistLocalUserNative(
    { id, username: uname, name, role: input.role, isActive: true },
    passwordHash,
  );
  return { id, name, role: input.role };
}

/**
 * Verify a username/password pair against the locally stored bcrypt hash.
 * Enforces a soft lockout (5 wrong attempts -> 60 s).
 */
export async function verifyOfflineLogin(
  username: string,
  password: string,
): Promise<OfflineLoginResult | null> {
  const until = Number(localStorage.getItem(LOCKOUT_KEY) ?? "0");
  if (until && Date.now() < until) {
    const secs = Math.ceil((until - Date.now()) / 1000);
    throw new Error(`Too many wrong attempts — try again in ${secs}s`);
  }

  const uname = username.trim().toLowerCase();
  const offlineDb = await getOfflineDb();
  const row = await offlineDb.account_creds.get(uname) as unknown as AccountCredCacheRow | undefined;

  // Fallback: when Dexie has no row (e.g. fresh browser profile
  // but the Tauri SQLite store does), try the native local_users table.
  if (!row) {
    const nativeMatch = await tryNativeOfflineLogin(uname, password);
    if (nativeMatch) {
      localStorage.removeItem(LOCKOUT_KEY);
      localStorage.removeItem(ATTEMPTS_KEY);
      return nativeMatch;
    }
    return null;
  }

  if (!row.is_active) return null;

  const ok = await bcrypt.compare(password, row.password_hash);
  if (ok) {
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
    return { id: row.user_id, name: row.name, role: row.role };
  }
  const attempts = Number(localStorage.getItem(ATTEMPTS_KEY) ?? "0") + 1;
  localStorage.setItem(ATTEMPTS_KEY, String(attempts));
  if (attempts >= MAX_ATTEMPTS) {
    localStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS));
    localStorage.setItem(ATTEMPTS_KEY, "0");
  }
  return null;
}

async function tryNativeOfflineLogin(
  username: string,
  password: string,
): Promise<OfflineLoginResult | null> {
  try {
    const { isTauri, nativeDb } = await import("@/utils/nativeDb");
    if (!isTauri()) return null;
    const u = await nativeDb.getLocalUserByUsername(username);
    if (!u || u.is_active === 0) return null;
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return null;
    return { id: u.id, name: u.name, role: u.role };
  } catch (err) {
    console.warn("tryNativeOfflineLogin failed:", err);
    return null;
  }
}

export async function isAccountCached(username: string): Promise<boolean> {
  const offlineDb = await getOfflineDb();
  const row = await offlineDb.account_creds.get(username.trim().toLowerCase());
  return Boolean(row);
}

export async function listCachedAccounts(): Promise<AccountCredCacheRow[]> {
  const offlineDb = await getOfflineDb();
  return (await offlineDb.account_creds.toArray()) as unknown as AccountCredCacheRow[];
}

export async function clearAccountCache(): Promise<void> {
  const offlineDb = await getOfflineDb();
  await offlineDb.account_creds.clear();
  localStorage.removeItem(LOCKOUT_KEY);
  localStorage.removeItem(ATTEMPTS_KEY);
}
