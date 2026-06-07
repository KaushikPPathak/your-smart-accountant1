// Read-side sync: pulls cloud data into the local IndexedDB cache so the
// app has something to render while offline.
//
// Strategy
//   • Per-company incremental pull keyed on `updated_at`. The high-water
//     mark for each (company, table) pair lives in `sync_cursors`.
//   • Last-write-wins: rows from the cloud replace local rows by `id`.
//   • Child tables (voucher_entries, voucher_items) are pulled by joining
//     against vouchers we just pulled so we can stay incremental without
//     adding an `updated_at` to those tables.
//   • Runs are best-effort. A failing table does NOT abort the whole pull;
//     it logs and continues so a transient RLS / network blip on one table
//     doesn't starve the rest.

import { supabase } from "@/integrations/supabase/client";
import { offlineDb, setMeta, type SyncCursorRow } from "./db";
import { isOnlineNow, pingOnline } from "./online-status";

const PAGE_SIZE = 1000;
const EPOCH = "1970-01-01T00:00:00.000Z";

const SNAPSHOT_TABLES = [
  "companies",
  "company_settings",
  "ledgers",
  "items",
  "account_subgroups",
  "ledger_group_mappings",
  "account_group_overrides",
  "vouchers",
] as const;

type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

function dexieFor(table: SnapshotTable) {
  switch (table) {
    case "companies": return offlineDb.cache_companies;
    case "company_settings": return offlineDb.cache_company_settings;
    case "ledgers": return offlineDb.cache_ledgers;
    case "items": return offlineDb.cache_items;
    case "account_subgroups": return offlineDb.cache_account_subgroups;
    case "ledger_group_mappings": return offlineDb.cache_ledger_group_mappings;
    case "account_group_overrides": return offlineDb.cache_account_group_overrides;
    case "vouchers": return offlineDb.cache_vouchers;
  }
}

async function getCursor(companyId: string, table: string): Promise<string> {
  const key = `${companyId}:${table}`;
  const row = await offlineDb.sync_cursors.get(key);
  return row?.last_updated_at ?? EPOCH;
}

async function setCursor(companyId: string, table: string, last_updated_at: string): Promise<void> {
  const row: SyncCursorRow = {
    key: `${companyId}:${table}`,
    company_id: companyId,
    table,
    last_updated_at,
    last_run_at: Date.now(),
  };
  await offlineDb.sync_cursors.put(row);
}

async function pullTable(table: SnapshotTable, companyId: string): Promise<number> {
  const since = await getCursor(companyId, table);
  let pulled = 0;
  let from = 0;
  let lastSeen = since;

  // companies table doesn't have company_id (it IS the company); special-case
  const isCompaniesTable = table === "companies";

  while (true) {
    // Dynamic table name defeats Supabase's typed query helpers; cast to a
    // loose builder so we can chain .eq with arbitrary column names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = (supabase.from(table as never) as any)
      .select("*")
      .order("updated_at", { ascending: true })
      .gt("updated_at", since)
      .range(from, from + PAGE_SIZE - 1);
    if (!isCompaniesTable) q = q.eq("company_id", companyId);
    else q = q.eq("id", companyId);

    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;

    const table_ = dexieFor(table);
    // Dexie's bulkPut typing is wide; we trust the cloud row shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (table_ as any).bulkPut(rows);
    pulled += rows.length;
    lastSeen = String(rows[rows.length - 1].updated_at ?? lastSeen);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (lastSeen !== since) await setCursor(companyId, table, lastSeen);
  return pulled;
}

async function pullVoucherChildren(companyId: string): Promise<{ entries: number; items: number }> {
  // Look at any voucher rows whose updated_at is newer than the last child
  // pull, then refresh THEIR entries/items. This keeps us correct even when
  // a voucher edit changes lines but not the children's identity.
  const childCursor = await getCursor(companyId, "voucher_children");
  const newish = await offlineDb.cache_vouchers
    .where("company_id").equals(companyId)
    .and((v) => String(v.updated_at) > childCursor)
    .toArray();
  if (newish.length === 0) return { entries: 0, items: 0 };

  const voucherIds = newish.map((v) => v.id);
  let entries = 0;
  let items = 0;
  let latest = childCursor;

  // Chunk the IN(...) to avoid URL length limits.
  for (let i = 0; i < voucherIds.length; i += 200) {
    const slice = voucherIds.slice(i, i + 200);

    const [{ data: eData, error: eErr }, { data: iData, error: iErr }] = await Promise.all([
      supabase.from("voucher_entries").select("*").in("voucher_id", slice),
      supabase.from("voucher_items").select("*").in("voucher_id", slice),
    ]);
    if (eErr) throw new Error(`voucher_entries: ${eErr.message}`);
    if (iErr) throw new Error(`voucher_items: ${iErr.message}`);

    // Replace-by-voucher to handle deleted lines.
    await offlineDb.cache_voucher_entries.where("voucher_id").anyOf(slice).delete();
    await offlineDb.cache_voucher_items.where("voucher_id").anyOf(slice).delete();
    if (eData?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await offlineDb.cache_voucher_entries.bulkPut(eData as any);
      entries += eData.length;
    }
    if (iData?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await offlineDb.cache_voucher_items.bulkPut(iData as any);
      items += iData.length;
    }
  }

  for (const v of newish) {
    if (String(v.updated_at) > latest) latest = String(v.updated_at);
  }
  await setCursor(companyId, "voucher_children", latest);
  return { entries, items };
}

export interface SnapshotResult {
  companyId: string;
  pulled: Record<string, number>;
  errors: Record<string, string>;
  finishedAt: number;
}

let pullInFlight: Promise<SnapshotResult | null> | null = null;

/**
 * Pull all cached tables for a single company. Best-effort: per-table
 * failures are recorded but do not abort other tables.
 */
export async function pullCompanySnapshot(companyId: string): Promise<SnapshotResult | null> {
  if (!isOnlineNow()) return null;
  const ok = await pingOnline();
  if (!ok) return null;

  const result: SnapshotResult = {
    companyId,
    pulled: {},
    errors: {},
    finishedAt: 0,
  };

  for (const table of SNAPSHOT_TABLES) {
    try {
      result.pulled[table] = await pullTable(table, companyId);
    } catch (e) {
      result.errors[table] = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const { entries, items } = await pullVoucherChildren(companyId);
    result.pulled.voucher_entries = entries;
    result.pulled.voucher_items = items;
  } catch (e) {
    result.errors.voucher_children = e instanceof Error ? e.message : String(e);
  }

  result.finishedAt = Date.now();
  await setMeta(`snapshot:last:${companyId}`, result);
  await setMeta("snapshot:last_any", result);
  return result;
}

/**
 * Pull snapshots for every company the current user has access to.
 * Coalesces concurrent calls.
 */
export async function pullSnapshot(): Promise<SnapshotResult | null> {
  if (pullInFlight) return pullInFlight;
  pullInFlight = (async () => {
    try {
      if (!isOnlineNow()) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: memberships, error } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", user.id);
      if (error) return null;

      const ids = Array.from(new Set((memberships ?? []).map((r) => r.company_id as string)));
      let last: SnapshotResult | null = null;
      for (const id of ids) {
        const r = await pullCompanySnapshot(id);
        if (r) last = r;
      }
      return last;
    } finally {
      pullInFlight = null;
    }
  })();
  return pullInFlight;
}

export async function getLastSnapshotResult(): Promise<SnapshotResult | null> {
  const row = await offlineDb.meta.get("snapshot:last_any");
  return (row?.value as SnapshotResult) ?? null;
}

/** Hard-reset every cache table + cursors. Useful from the status drawer. */
export async function resetSnapshotCache(): Promise<void> {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.cache_companies,
      offlineDb.cache_company_settings,
      offlineDb.cache_ledgers,
      offlineDb.cache_items,
      offlineDb.cache_account_subgroups,
      offlineDb.cache_ledger_group_mappings,
      offlineDb.cache_account_group_overrides,
      offlineDb.cache_vouchers,
      offlineDb.cache_voucher_entries,
      offlineDb.cache_voucher_items,
      offlineDb.sync_cursors,
    ],
    async () => {
      await Promise.all([
        offlineDb.cache_companies.clear(),
        offlineDb.cache_company_settings.clear(),
        offlineDb.cache_ledgers.clear(),
        offlineDb.cache_items.clear(),
        offlineDb.cache_account_subgroups.clear(),
        offlineDb.cache_ledger_group_mappings.clear(),
        offlineDb.cache_account_group_overrides.clear(),
        offlineDb.cache_vouchers.clear(),
        offlineDb.cache_voucher_entries.clear(),
        offlineDb.cache_voucher_items.clear(),
        offlineDb.sync_cursors.clear(),
      ]);
    },
  );
}
