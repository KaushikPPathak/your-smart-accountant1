// Cache schema version stamp.
//
// Bump SCHEMA_VERSION whenever a new field is added to any cached table
// (or to a normalizer in cache-normalizers.ts). On app boot the stamp is
// compared against what's in Dexie's `meta` table. If the local stamp is
// missing or lower, the cache is considered stale — for online, non
// local-only companies we silently trigger a full snapshot refetch so
// the user self-heals with zero interaction. Local-only companies keep
// their data (we cannot refetch what only exists on-device) and instead
// see a soft "Rebuild recommended" banner on /app/data-health.
//
// This is what makes future migrations painless: bump the number, add
// one line to a normalizer, and every existing install repairs itself.

import { getMeta, setMeta } from "./db";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { isOnlineNow } from "./online-status";

export const SCHEMA_VERSION = 8;
const KEY = "schema_version";

export async function getStoredSchemaVersion(): Promise<number> {
  const v = await getMeta<number>(KEY);
  return typeof v === "number" ? v : 0;
}

export async function stampSchemaVersion(): Promise<void> {
  await setMeta(KEY, SCHEMA_VERSION);
}

export interface SchemaCheckResult {
  storedVersion: number;
  currentVersion: number;
  stale: boolean;
  action: "up-to-date" | "refetched" | "needs-rebuild" | "skipped-offline";
}

/**
 * Runs at boot. If cache is older than the app expects:
 *   - online + not local-only: full snapshot pull, then stamp bumps.
 *   - local-only or offline: leave data alone, surface banner via
 *     /app/data-health so the user can trigger rebuild when they want.
 */
export async function checkSchemaVersionOnBoot(): Promise<SchemaCheckResult> {
  const storedVersion = await getStoredSchemaVersion();
  const currentVersion = SCHEMA_VERSION;
  if (storedVersion >= currentVersion) {
    return { storedVersion, currentVersion, stale: false, action: "up-to-date" };
  }

  // Stale. Decide whether we can silently repair.
  if (isLocalOnlyMode()) {
    return { storedVersion, currentVersion, stale: true, action: "needs-rebuild" };
  }
  if (!isOnlineNow()) {
    return { storedVersion, currentVersion, stale: true, action: "skipped-offline" };
  }

  try {
    const { pullSnapshot } = await import("./snapshot");
    await pullSnapshot({ full: true, forceExact: true });
    await stampSchemaVersion();
    return { storedVersion, currentVersion, stale: true, action: "refetched" };
  } catch (err) {
    console.warn("Schema-version refetch failed:", err);
    return { storedVersion, currentVersion, stale: true, action: "needs-rebuild" };
  }
}
