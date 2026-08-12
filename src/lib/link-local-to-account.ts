// Migrate local device companies to a freshly-authenticated cloud account.
//
// Local-first users have all their business data in IndexedDB, tagged with
// the local device id (or the sentinel "local-user"). When they later
// connect an account, we simply re-tag those rows to the new account id.
// No data leaves the device — local-only mode stays ON. This is purely a
// bookkeeping change so future cloud-sync opt-in has a clean ownership
// pointer.

import { getLocalDeviceId, markLocalProfileLinked } from "./local-device-profile";

const LOCAL_OWNERS = new Set<string>(["local-user"]);

export async function linkLocalCompaniesToAccount(newAccountId: string): Promise<{ moved: number }> {
  if (!newAccountId) return { moved: 0 };

  const deviceId = getLocalDeviceId();
  if (deviceId) LOCAL_OWNERS.add(deviceId);

  let moved = 0;
  try {
    const mod = await import("@/lib/offline/db");
    const db = mod.default || mod.offlineDb;

    const rows: Array<{ id: string; account_id?: string | null }> =
      await db.companies.toArray().catch(() => [] as Array<{ id: string; account_id?: string | null }>);
    for (const row of rows) {
      if (!row?.id) continue;
      const owner = row.account_id ?? null;
      if (owner === newAccountId) continue;
      if (owner === null || LOCAL_OWNERS.has(owner)) {
        try {
          const updated = await db.companies.update(row.id, { account_id: newAccountId });
          // Dexie returns 1 on success, 0 when no row matched. Stub returns undefined.
          if (updated === 1 || updated === undefined) moved += 1;
        } catch { /* skip this row, keep going */ }
      }
    }
  } catch (err) {
    console.warn("linkLocalCompaniesToAccount failed:", err);
  }

  markLocalProfileLinked();
  return { moved };
}
