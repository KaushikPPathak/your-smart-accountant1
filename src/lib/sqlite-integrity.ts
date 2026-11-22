// Startup check of the desktop SQLite book file: PRAGMA integrity_check. The result is recorded in
// localStorage so the app can show it. A failed check never blocks the app or deletes anything.
import { getDb, isTauri } from "@/utils/nativeDb";

export const INTEGRITY_KEY = "sqlite_integrity_last";

export interface IntegrityResult {
  ok: boolean;
  checkedAt: string;
  detail: string;
}

export async function checkSqliteIntegrity(): Promise<IntegrityResult> {
  const checkedAt = new Date().toISOString();
  let result: IntegrityResult;
  if (!isTauri()) {
    result = { ok: true, checkedAt, detail: "not the desktop app" };
  } else try {
    const db = await getDb();
    const rows = (await db.select("PRAGMA integrity_check")) as Record<string, unknown>[];
    const messages = rows.map((r) => String(Object.values(r)[0] ?? ""));
    const ok = messages.length === 1 && messages[0] === "ok";
    result = { ok, checkedAt, detail: ok ? "ok" : messages.slice(0, 5).join("; ") };
  } catch (err) {
    result = { ok: false, checkedAt, detail: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) console.warn("SQLite integrity check failed:", result.detail);
  try {
    localStorage.setItem(INTEGRITY_KEY, JSON.stringify(result));
  } catch {
    // storage may be unavailable; the result is still returned
  }
  return result;
}

/** The last recorded check, or null when none has run on this computer. */
export function lastIntegrityResult(): IntegrityResult | null {
  try {
    const raw = localStorage.getItem(INTEGRITY_KEY);
    return raw ? (JSON.parse(raw) as IntegrityResult) : null;
  } catch {
    return null;
  }
}
