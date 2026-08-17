// Local-only mode: the master switch that keeps ALL business data on the
// user's device. When enabled (the default going forward), nothing the user
// enters — companies, vouchers, ledgers, items, settings — is ever pushed
// to our servers. The outbox stops draining, the snapshot puller stops
// pulling, and every read/write is served from local IndexedDB.
//
// Auth (login/signup, profile display) still uses the cloud so the user can
// identify themselves across their own devices, but business data lives on
// the device and only leaves it via user-controlled backups (their own
// Google Drive / OneDrive / Dropbox / manual file — coming next).
const STORAGE_KEY = "ym_local_only_mode";
const DEFAULT = true;
const listeners = new Set();
function readRaw() {
    if (typeof window === "undefined")
        return DEFAULT;
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === null)
            return DEFAULT;
        return v === "1" || v === "true";
    }
    catch {
        return DEFAULT;
    }
}
let cached = null;
export function isLocalOnlyMode() {
    if (cached === null)
        cached = readRaw();
    return cached;
}
export function setLocalOnlyMode(enabled) {
    cached = enabled;
    try {
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
        }
    }
    catch { /* ignore */ }
    for (const fn of listeners) {
        try {
            fn(enabled);
        }
        catch { /* ignore */ }
    }
}
export function subscribeLocalOnlyMode(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
