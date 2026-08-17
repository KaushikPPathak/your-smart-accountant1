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
// Dynamically resolve the offline database instance to avoid top-level bundler collision
async function getOfflineDb() {
    const module = await import("./db");
    return module.default || module.offlineDb || module.db;
}
const LOCKOUT_KEY = "ym_local_lock_until";
const ATTEMPTS_KEY = "ym_local_lock_attempts";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60000;
export async function cacheAccountCredsFromCloud(username, plaintextPassword) {
    const uname = username.trim().toLowerCase();
    if (!uname)
        return;
    try {
        const { data, error } = await supabase
            .from("app_users")
            .select("id,name,role,username,password_hash,is_active")
            .eq("username", uname)
            .maybeSingle();
        if (error || !data || !data.password_hash)
            return;
        const row = {
            username: uname,
            user_id: data.id,
            name: data.name ?? "",
            role: data.role ?? "staff",
            password_hash: data.password_hash,
            is_active: data.is_active ?? true,
            cached_at: Date.now(),
        };
        const offlineDb = await getOfflineDb();
        await offlineDb.account_creds.put(row);
        // Also persist into the native SQLite store so the Tauri desktop
        // app can authenticate this user fully offline after one successful
        // online login.
        await persistLocalUserNative({
            id: row.user_id,
            username: uname,
            name: row.name,
            role: row.role,
            isActive: row.is_active,
        }, plaintextPassword, row.password_hash);
    }
    catch (err) {
        console.warn("cacheAccountCredsFromCloud failed:", err);
    }
}
async function persistLocalUserNative(identity, plaintextPassword, cloudHash) {
    try {
        const { isTauri, nativeDb } = await import("@/utils/nativeDb");
        if (!isTauri())
            return;
        const localHash = plaintextPassword
            ? await bcrypt.hash(plaintextPassword, 10)
            : cloudHash;
        const result = await nativeDb.upsertLocalUser({
            id: identity.id,
            username: identity.username,
            name: identity.name,
            role: identity.role,
            passwordHash: localHash,
            isActive: identity.isActive,
        });
        console.log(`✅ Local user registration success (${result.updated ? "updated" : "inserted"}):`, identity.username);
    }
    catch (err) {
        console.error("❌ Local user registration failure:", err);
    }
}
export async function refreshAllCachedCreds() {
    try {
        const offlineDb = await getOfflineDb();
        const rows = await offlineDb.account_creds.toArray();
        if (rows.length === 0)
            return;
        const usernames = rows.map((r) => r.username);
        const { data, error } = await supabase
            .from("app_users")
            .select("id,name,role,username,password_hash,is_active")
            .in("username", usernames);
        if (error || !data)
            return;
        const fresh = [];
        for (const d of data) {
            if (!d.username || !d.password_hash)
                continue;
            fresh.push({
                username: d.username.toLowerCase(),
                user_id: d.id,
                name: d.name ?? "",
                role: d.role ?? "staff",
                password_hash: d.password_hash,
                is_active: d.is_active ?? true,
                cached_at: Date.now(),
            });
        }
        if (fresh.length)
            await offlineDb.account_creds.bulkPut(fresh);
    }
    catch {
        /* ignore */
    }
}
/**
 * Verify a username/password pair against the locally cached bcrypt hash.
 * Enforces a soft lockout (5 wrong attempts -> 60 s) mirroring the server.
 */
export async function verifyOfflineLogin(username, password) {
    const until = Number(localStorage.getItem(LOCKOUT_KEY) ?? "0");
    if (until && Date.now() < until) {
        const secs = Math.ceil((until - Date.now()) / 1000);
        throw new Error(`Too many wrong attempts — try again in ${secs}s`);
    }
    const uname = username.trim().toLowerCase();
    const offlineDb = await getOfflineDb();
    const row = await offlineDb.account_creds.get(uname);
    // Fallback: when Dexie has no cached row (e.g. fresh browser profile
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
    if (!row.is_active)
        return null;
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
async function tryNativeOfflineLogin(username, password) {
    try {
        const { isTauri, nativeDb } = await import("@/utils/nativeDb");
        if (!isTauri())
            return null;
        const u = await nativeDb.getLocalUserByUsername(username);
        if (!u || u.is_active === 0)
            return null;
        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok)
            return null;
        return { id: u.id, name: u.name, role: u.role };
    }
    catch (err) {
        console.warn("tryNativeOfflineLogin failed:", err);
        return null;
    }
}
export async function isAccountCached(username) {
    const offlineDb = await getOfflineDb();
    const row = await offlineDb.account_creds.get(username.trim().toLowerCase());
    return Boolean(row);
}
export async function listCachedAccounts() {
    const offlineDb = await getOfflineDb();
    return (await offlineDb.account_creds.toArray());
}
export async function clearAccountCache() {
    const offlineDb = await getOfflineDb();
    await offlineDb.account_creds.clear();
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
}
