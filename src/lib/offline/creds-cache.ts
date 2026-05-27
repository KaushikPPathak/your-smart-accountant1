// Local cache of login credentials so a user can sign in without internet.
//
// On every SUCCESSFUL online login we fetch the matching app_users row
// (auth-only readable to authenticated users) and store its bcrypt
// password_hash locally. On subsequent offline launches we verify the
// password against that cached hash using bcryptjs.
//
// SECURITY: the cache only contains a bcrypt hash, never the plaintext
// password. The same hash already lives in the cloud DB.

import bcrypt from "bcryptjs";
import { supabase } from "@/integrations/supabase/client";
import { offlineDb, type AccountCredCacheRow } from "./db";

const LOCKOUT_KEY = "ym_local_lock_until";
const ATTEMPTS_KEY = "ym_local_lock_attempts";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

export async function cacheAccountCredsFromCloud(username: string): Promise<void> {
  const uname = username.trim().toLowerCase();
  if (!uname) return;
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("id,name,role,username,password_hash,is_active")
      .eq("username", uname)
      .maybeSingle();
    if (error || !data || !data.password_hash) return;
    const row: AccountCredCacheRow = {
      username: uname,
      user_id: data.id as string,
      name: (data.name as string) ?? "",
      role: (data.role as string) ?? "staff",
      password_hash: data.password_hash as string,
      is_active: (data.is_active as boolean) ?? true,
      cached_at: Date.now(),
    };
    await offlineDb.account_creds.put(row);
  } catch {
    /* best-effort cache; ignore failures */
  }
}

export async function refreshAllCachedCreds(): Promise<void> {
  try {
    const rows = await offlineDb.account_creds.toArray();
    if (rows.length === 0) return;
    const usernames = rows.map((r) => r.username);
    const { data, error } = await supabase
      .from("app_users")
      .select("id,name,role,username,password_hash,is_active")
      .in("username", usernames);
    if (error || !data) return;
    const fresh: AccountCredCacheRow[] = data
      .filter((d): d is { id: string; name: string; role: string; username: string; password_hash: string; is_active: boolean } =>
        Boolean(d.username && d.password_hash))
      .map((d) => ({
        username: d.username.toLowerCase(),
        user_id: d.id,
        name: d.name ?? "",
        role: d.role ?? "staff",
        password_hash: d.password_hash,
        is_active: d.is_active ?? true,
        cached_at: Date.now(),
      }));
    await offlineDb.account_creds.bulkPut(fresh);
  } catch {
    /* ignore */
  }
}

export interface OfflineLoginResult {
  id: string;
  name: string;
  role: string;
}

/**
 * Verify a username/password pair against the locally cached bcrypt hash.
 * Enforces a soft lockout (5 wrong attempts -> 60 s) mirroring the server.
 *
 * Returns null on a wrong password; throws on lockout or "no cache".
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
  const row = await offlineDb.account_creds.get(uname);
  if (!row) {
    throw new Error(
      "This user hasn't been used on this machine yet. Please connect to the internet for the first login.",
    );
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

export async function isAccountCached(username: string): Promise<boolean> {
  const row = await offlineDb.account_creds.get(username.trim().toLowerCase());
  return Boolean(row);
}

export async function clearAccountCache(): Promise<void> {
  await offlineDb.account_creds.clear();
  localStorage.removeItem(LOCKOUT_KEY);
  localStorage.removeItem(ATTEMPTS_KEY);
}
