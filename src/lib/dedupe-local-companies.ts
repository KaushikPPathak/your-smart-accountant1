// Automatic dedupe of local-only companies.
//
// Why this exists: in local-only mode the picker used to merge cloud-side
// `companies_picker` rows with local `cache_companies`. A restore-from-file
// could therefore leave the app showing two rows for the same company —
// one empty ghost (leftover cloud/local id) and one that actually holds
// the restored ledgers/items/vouchers. We now short-circuit the cloud
// fetch, but any *pre-existing* duplicates already saved to IndexedDB
// would still show up. This function runs once on startup and physically
// removes those empty duplicates from IndexedDB so they can never come
// back — not just hidden in the picker, actually deleted.
//
// Rule:
//   - Group companies by lowercased trimmed name.
//   - For each group, count rows in cache_ledgers + cache_items +
//     cache_vouchers per company id.
//   - Keep the id with the most rows (winner). On a tie, keep the
//     lexicographically smallest id so the choice is deterministic.
//   - Delete every other id in the group from BOTH `companies` (picker
//     cache) and `cache_companies` (snapshot cache). Do NOT touch any
//     *_cache business tables — losers have no business rows by
//     definition of "empty duplicate", and this keeps the operation
//     safe even if the heuristic is ever wrong (data is preserved).
//
// Local-only guard: never runs when local-only mode is off, because in
// cloud-sync mode the snapshot puller is the source of truth and
// deleting picker rows would just reappear on next sync.

import { isLocalOnlyMode } from "@/lib/local-only-mode";

const RAN_KEY = "ym_local_dedupe_ran_v1";

export async function dedupeLocalCompaniesOnce(): Promise<{ removed: number } | null> {
  if (!isLocalOnlyMode()) return null;
  try {
    if (typeof window !== "undefined" && window.sessionStorage.getItem(RAN_KEY) === "1") {
      return { removed: 0 };
    }
  } catch { /* ignore */ }

  try {
    const mod = await import("@/lib/offline/db");
    const db: any = (mod as any).default || (mod as any).offlineDb || (mod as any).db;
    if (!db) return null;

    const [picker, snapshot] = await Promise.all([
      db.companies.toArray().catch(() => []),
      db.cache_companies.toArray().catch(() => []),
    ]);

    // Merge into a single map keyed by id, preferring snapshot fields.
    const byId = new Map<string, any>();
    for (const c of picker || []) if (c?.id) byId.set(String(c.id), c);
    for (const c of snapshot || []) if (c?.id) byId.set(String(c.id), { ...(byId.get(String(c.id)) ?? {}), ...c });

    // Group ids by normalised name.
    const groups = new Map<string, string[]>();
    for (const c of byId.values()) {
      const name = String(c.name || c.company_name || "").trim().toLowerCase();
      if (!name) continue;
      const arr = groups.get(name) ?? [];
      arr.push(String(c.id));
      groups.set(name, arr);
    }

    const toDelete: string[] = [];
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const scored = await Promise.all(
        ids.map(async (id) => {
          const [l, i, v] = await Promise.all([
            db.cache_ledgers.where("company_id").equals(id).count().catch(() => 0),
            db.cache_items.where("company_id").equals(id).count().catch(() => 0),
            db.cache_vouchers.where("company_id").equals(id).count().catch(() => 0),
          ]);
          return { id, rows: (l as number) + (i as number) + (v as number) };
        }),
      );
      scored.sort((a, b) => (b.rows - a.rows) || (a.id < b.id ? -1 : 1));
      const winner = scored[0];
      for (const s of scored.slice(1)) {
        // Safety: only delete losers that truly have zero business rows.
        if (s.rows === 0 && winner.rows > 0) toDelete.push(s.id);
      }
    }

    if (toDelete.length > 0) {
      await Promise.all([
        db.companies.bulkDelete(toDelete).catch(() => undefined),
        db.cache_companies.bulkDelete(toDelete).catch(() => undefined),
        db.cache_company_settings.where("company_id").anyOf(toDelete).delete().catch(() => undefined),
      ]);
    }

    try { window.sessionStorage.setItem(RAN_KEY, "1"); } catch { /* ignore */ }
    return { removed: toDelete.length };
  } catch (e) {
    console.warn("dedupeLocalCompaniesOnce failed:", e);
    return null;
  }
}
