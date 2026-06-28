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
import { isOnlineNow, pingOnline } from "./online-status";

// Declare interface inline to permanently break the Rollup AST parsing deadlock
export interface SyncCursorRow {
  key: string;
  company_id: string;
  table: string;
  last_updated_at: string;
  last_run_at: number;
}

// Runtime dynamic import resolver to completely bypass top-of-file compilation crashes
async function getDbInstance() {
  const module = await import("./db");
  return {
    db: module.default || module.offlineDb || (module as any).db,
    setMeta: module.setMeta
  };
}

const PAGE_SIZE = 1000;
const EPOCH = "1970-01-01T00:00:00.000Z";

// Tables pulled on every snapshot tick. Kept intentionally small so the
// first boot only hydrates what the lock screen and dashboard actually
// need (companies + their settings). Per-company heavy tables (ledgers,
// items, vouchers, voucher children) are pulled lazily by
// pullCompanySnapshot(id, { full: true }) when the user opens a company.
const MINIMAL_TABLES = ["companies", "company_settings"] as const;
const HEAVY_TABLES = [
  "ledgers",
  "items",
  "account_subgroups",
  "ledger_group_mappings",
  "account_group_overrides",
  "vouchers",
  "bill_allocations",
] as const;
const SNAPSHOT_TABLES = [...MINIMAL_TABLES, ...HEAVY_TABLES] as const;

type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

type CacheRow = Record<string, unknown>;
type ExactSnapshotRows = Record<string, CacheRow[]>;

export interface SnapshotVerificationTable {
  cloudCount: number;
  localCount: number;
  cloudChecksum: string;
  localChecksum: string;
  match: boolean;
}

export interface SnapshotVerification {
  ok: boolean;
  checkedAt: number;
  tables: Record<string, SnapshotVerificationTable>;
  problems: string[];
}

function dexieFor(table: SnapshotTable, db: any) {
  switch (table) {
    case "companies": return db.cache_companies;
    case "company_settings": return db.cache_company_settings;
    case "ledgers": return db.cache_ledgers;
    case "items": return db.cache_items;
    case "account_subgroups": return db.cache_account_subgroups;
    case "ledger_group_mappings": return db.cache_ledger_group_mappings;
    case "account_group_overrides": return db.cache_account_group_overrides;
    case "vouchers": return db.cache_vouchers;
    case "bill_allocations": return db.cache_bill_allocations;
  }
}

function normalizeRowsForCache(table: SnapshotTable, rows: Array<Record<string, unknown>>) {
  return table === "company_settings"
    ? rows.map((r) => ({ ...r, id: (r as any).id ?? (r as any).company_id }))
    : rows;
}

function rowUpdatedAt(row: Record<string, unknown>, fallback: string) {
  const value = row.updated_at ?? row.created_at ?? fallback;
  return String(value || fallback);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function checksumRows(rows: CacheRow[]): string {
  let hash = 2166136261;
  const sorted = [...rows].sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const input = sorted.map(stableStringify).join("\n");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function dedupeRows(rows: CacheRow[]): CacheRow[] {
  const seen = new Map<string, CacheRow>();
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    seen.set(id, row);
  }
  return Array.from(seen.values());
}

function tableOrderColumn(table: SnapshotTable): string {
  return table === "company_settings" ? "company_id" : "id";
}

function latestUpdatedAt(rows: CacheRow[]): string {
  let latest = EPOCH;
  for (const row of rows) {
    const candidate = rowUpdatedAt(row, EPOCH);
    if (candidate > latest) latest = candidate;
  }
  return latest;
}

async function getCursor(companyId: string, table: string): Promise<string> {
  const key = `${companyId}:${table}`;
  const { db } = await getDbInstance();
  const row = await db.sync_cursors.get(key);
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
  const { db } = await getDbInstance();
  await db.sync_cursors.put(row);
}

async function fetchExactTableRows(table: SnapshotTable, companyId: string): Promise<CacheRow[]> {
  const rows: CacheRow[] = [];
  let from = 0;
  const isCompaniesTable = table === "companies";
  while (true) {
    let q: any = (supabase.from(table as never) as any)
      .select("*")
      .range(from, from + PAGE_SIZE - 1)
      .order(tableOrderColumn(table), { ascending: true });
    q = isCompaniesTable ? q.eq("id", companyId) : q.eq("company_id", companyId);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = normalizeRowsForCache(table, (data ?? []) as CacheRow[]);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return dedupeRows(rows);
}

async function fetchExactVoucherChildren(companyId: string, vouchers: CacheRow[]): Promise<{ entries: CacheRow[]; items: CacheRow[] }> {
  const voucherIds = vouchers.map((v) => String(v.id ?? "")).filter(Boolean);
  const entries: CacheRow[] = [];
  const items: CacheRow[] = [];
  for (let i = 0; i < voucherIds.length; i += 200) {
    const slice = voucherIds.slice(i, i + 200);
    const [{ data: eData, error: eErr }, { data: iData, error: iErr }] = await Promise.all([
      supabase.from("voucher_entries").select("*").in("voucher_id", slice),
      supabase.from("voucher_items").select("*").in("voucher_id", slice),
    ]);
    if (eErr) throw new Error(`voucher_entries: ${eErr.message}`);
    if (iErr) throw new Error(`voucher_items: ${iErr.message}`);
    entries.push(...((eData ?? []) as CacheRow[]).map((r) => ({ ...r, company_id: companyId })));
    items.push(...((iData ?? []) as CacheRow[]).map((r) => ({ ...r, company_id: companyId })));
  }
  return { entries: dedupeRows(entries), items: dedupeRows(items) };
}

function verifySnapshotRows(rows: ExactSnapshotRows): SnapshotVerification {
  const problems: string[] = [];
  const tables: Record<string, SnapshotVerificationTable> = {};
  for (const [table, list] of Object.entries(rows)) {
    const ids = list.map((r) => String(r.id ?? "")).filter(Boolean);
    const unique = new Set(ids);
    if (ids.length !== unique.size) problems.push(`${table}: duplicate row id found in pulled data`);
    const checksum = checksumRows(list);
    tables[table] = {
      cloudCount: list.length,
      localCount: list.length,
      cloudChecksum: checksum,
      localChecksum: checksum,
      match: ids.length === unique.size,
    };
  }

  const voucherIds = new Set((rows.vouchers ?? []).map((v) => String(v.id ?? "")));
  for (const e of rows.voucher_entries ?? []) {
    if (!voucherIds.has(String(e.voucher_id ?? ""))) problems.push(`voucher_entries: orphan entry ${String(e.id ?? "")}`);
  }
  for (const item of rows.voucher_items ?? []) {
    if (!voucherIds.has(String(item.voucher_id ?? ""))) problems.push(`voucher_items: orphan item line ${String(item.id ?? "")}`);
  }

  const ledgerIds = new Set((rows.ledgers ?? []).map((l) => String(l.id ?? "")));
  for (const e of rows.voucher_entries ?? []) {
    if (e.ledger_id && !ledgerIds.has(String(e.ledger_id))) problems.push(`voucher_entries: missing ledger ${String(e.ledger_id)}`);
  }

  return {
    ok: problems.length === 0,
    checkedAt: Date.now(),
    tables,
    problems,
  };
}

async function localRowsForExactTable(db: any, companyId: string, table: string): Promise<CacheRow[]> {
  if (table === "companies") {
    const row = await db.cache_companies.get(companyId);
    return row ? [row] : [];
  }
  if (table === "company_settings") return db.cache_company_settings.where("company_id").equals(companyId).toArray();
  if (table === "ledgers") return db.cache_ledgers.where("company_id").equals(companyId).toArray();
  if (table === "items") return db.cache_items.where("company_id").equals(companyId).toArray();
  if (table === "account_subgroups") return db.cache_account_subgroups.where("company_id").equals(companyId).toArray();
  if (table === "ledger_group_mappings") return db.cache_ledger_group_mappings.where("company_id").equals(companyId).toArray();
  if (table === "account_group_overrides") return db.cache_account_group_overrides.where("company_id").equals(companyId).toArray();
  if (table === "vouchers") return db.cache_vouchers.where("company_id").equals(companyId).toArray();
  if (table === "voucher_entries") return db.cache_voucher_entries.where("company_id").equals(companyId).toArray();
  if (table === "voucher_items") return db.cache_voucher_items.where("company_id").equals(companyId).toArray();
  if (table === "bill_allocations") return db.cache_bill_allocations.where("company_id").equals(companyId).toArray();
  return [];
}

async function verifyLocalMatches(companyId: string, cloudRows: ExactSnapshotRows): Promise<SnapshotVerification> {
  const { db } = await getDbInstance();
  const problems: string[] = [];
  const tables: Record<string, SnapshotVerificationTable> = {};
  for (const [table, cloud] of Object.entries(cloudRows)) {
    const local = await localRowsForExactTable(db, companyId, table);
    const cloudChecksum = checksumRows(cloud);
    const localChecksum = checksumRows(local);
    const match = cloud.length === local.length && cloudChecksum === localChecksum;
    if (!match) problems.push(`${table}: online ${cloud.length}/${cloudChecksum} offline ${local.length}/${localChecksum}`);
    tables[table] = {
      cloudCount: cloud.length,
      localCount: local.length,
      cloudChecksum,
      localChecksum,
      match,
    };
  }
  return { ok: problems.length === 0, checkedAt: Date.now(), tables, problems };
}

async function writeExactSnapshotRows(companyId: string, rows: ExactSnapshotRows): Promise<void> {
  const { db } = await getDbInstance();
  await db.transaction(
    "rw",
    db.cache_companies,
    db.cache_company_settings,
    db.cache_ledgers,
    db.cache_items,
    db.cache_account_subgroups,
    db.cache_ledger_group_mappings,
    db.cache_account_group_overrides,
    db.cache_vouchers,
    db.cache_voucher_entries,
    db.cache_voucher_items,
    db.cache_bill_allocations,
    async () => {
      await Promise.all([
        db.cache_companies.delete(companyId),
        db.cache_company_settings.where("company_id").equals(companyId).delete(),
        db.cache_ledgers.where("company_id").equals(companyId).delete(),
        db.cache_items.where("company_id").equals(companyId).delete(),
        db.cache_account_subgroups.where("company_id").equals(companyId).delete(),
        db.cache_ledger_group_mappings.where("company_id").equals(companyId).delete(),
        db.cache_account_group_overrides.where("company_id").equals(companyId).delete(),
        db.cache_vouchers.where("company_id").equals(companyId).delete(),
        db.cache_voucher_entries.where("company_id").equals(companyId).delete(),
        db.cache_voucher_items.where("company_id").equals(companyId).delete(),
        db.cache_bill_allocations.where("company_id").equals(companyId).delete(),
      ]);
      if (rows.companies?.length) await db.cache_companies.bulkPut(rows.companies);
      if (rows.company_settings?.length) await db.cache_company_settings.bulkPut(rows.company_settings);
      if (rows.ledgers?.length) await db.cache_ledgers.bulkPut(rows.ledgers);
      if (rows.items?.length) await db.cache_items.bulkPut(rows.items);
      if (rows.account_subgroups?.length) await db.cache_account_subgroups.bulkPut(rows.account_subgroups);
      if (rows.ledger_group_mappings?.length) await db.cache_ledger_group_mappings.bulkPut(rows.ledger_group_mappings);
      if (rows.account_group_overrides?.length) await db.cache_account_group_overrides.bulkPut(rows.account_group_overrides);
      if (rows.vouchers?.length) await db.cache_vouchers.bulkPut(rows.vouchers);
      if (rows.voucher_entries?.length) await db.cache_voucher_entries.bulkPut(rows.voucher_entries);
      if (rows.voucher_items?.length) await db.cache_voucher_items.bulkPut(rows.voucher_items);
      if (rows.bill_allocations?.length) await db.cache_bill_allocations.bulkPut(rows.bill_allocations);
    },
  );
}

async function pullExactCompanySnapshot(companyId: string): Promise<{ pulled: Record<string, number>; verification: SnapshotVerification }> {
  const rows: ExactSnapshotRows = {};
  await Promise.all(SNAPSHOT_TABLES.map(async (table) => {
    rows[table] = await fetchExactTableRows(table, companyId);
  }));
  const children = await fetchExactVoucherChildren(companyId, rows.vouchers ?? []);
  rows.voucher_entries = children.entries;
  rows.voucher_items = children.items;

  const preflight = verifySnapshotRows(rows);
  if (!preflight.ok) {
    return {
      pulled: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])),
      verification: preflight,
    };
  }

  await writeExactSnapshotRows(companyId, rows);
  await Promise.all([
    ...SNAPSHOT_TABLES.map((table) => setCursor(companyId, table, latestUpdatedAt(rows[table] ?? []))),
    setCursor(companyId, "voucher_children", latestUpdatedAt(rows.vouchers ?? [])),
  ]);

  return {
    pulled: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])),
    verification: await verifyLocalMatches(companyId, rows),
  };
}

async function pullTable(table: SnapshotTable, companyId: string, opts: { exact?: boolean } = {}): Promise<number> {
  const since = await getCursor(companyId, table);
  let pulled = 0;
  let from = 0;
  let lastSeen = since;
  const exactRows: Array<Record<string, unknown>> = [];

  const isCompaniesTable = table === "companies";

  while (true) {
    let q: any = (supabase.from(table as never) as any)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (!opts.exact) {
      q = q.order("updated_at", { ascending: true }).gt("updated_at", since);
    } else if (table === "bill_allocations") {
      q = q.order("created_at", { ascending: true });
    } else {
      q = q.order("updated_at", { ascending: true });
    }
    if (!isCompaniesTable) q = q.eq("company_id", companyId);
    else q = q.eq("id", companyId);

    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;

    if (opts.exact) {
      exactRows.push(...rows);
    } else {
      const { db } = await getDbInstance();
      const table_ = dexieFor(table, db);
      const rowsForCache = normalizeRowsForCache(table, rows);
      await (table_ as any).bulkPut(rowsForCache);
    }
    pulled += rows.length;
    lastSeen = rowUpdatedAt(rows[rows.length - 1], lastSeen);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (opts.exact) {
    const { db } = await getDbInstance();
    const table_ = dexieFor(table, db);
    const rowsForCache = normalizeRowsForCache(table, exactRows);
    await db.transaction("rw", table_, async () => {
      if (isCompaniesTable) await (table_ as any).delete(companyId);
      else await (table_ as any).where("company_id").equals(companyId).delete();
      if (rowsForCache.length) await (table_ as any).bulkPut(rowsForCache);
    });
  }

  if (opts.exact || lastSeen !== since) await setCursor(companyId, table, lastSeen);
  return pulled;
}

async function pruneOrphanCachedChildren(db: any) {
  const voucherIds = new Set((await db.cache_vouchers.toArray()).map((v: any) => String(v.id)));
  await Promise.all([
    db.cache_voucher_entries.filter((e: any) => !voucherIds.has(String(e.voucher_id))).delete(),
    db.cache_voucher_items.filter((e: any) => !voucherIds.has(String(e.voucher_id))).delete(),
  ]);
}

async function pullVoucherChildren(companyId: string, opts: { exact?: boolean } = {}): Promise<{ entries: number; items: number }> {
  const childCursor = await getCursor(companyId, "voucher_children");
  const { db } = await getDbInstance();
  const allCachedVouchers = await db.cache_vouchers
    .where("company_id").equals(companyId)
    .toArray();
  let newish = opts.exact
    ? allCachedVouchers
    : allCachedVouchers.filter((v: any) => String(v.updated_at) > childCursor);

  // Recovery path: older builds could advance cursors while voucher_entries /
  // voucher_items were not actually present in IndexedDB. In that state the
  // sync screen says "complete" but offline reports have no postings. If a
  // company has vouchers but no cached children, force a one-time full child
  // hydrate instead of trusting the cursor.
  if (newish.length === 0 && allCachedVouchers.length > 0) {
    const sampleIds = allCachedVouchers.slice(0, 500).map((v: any) => v.id);
    const [entryCount, itemCount] = await Promise.all([
      sampleIds.length ? db.cache_voucher_entries.where("voucher_id").anyOf(sampleIds).count() : 0,
      sampleIds.length ? db.cache_voucher_items.where("voucher_id").anyOf(sampleIds).count() : 0,
    ]);
    if (entryCount === 0) newish = allCachedVouchers;
  }

  // Normal incremental path: only vouchers changed since the last child pull.
  // The query above is intentionally in memory because all candidate vouchers
  // for this company are already in the local cache.
  newish = newish.length > 0 ? newish : await db.cache_vouchers
    .where("company_id").equals(companyId)
    .and((v: any) => String(v.updated_at) > childCursor)
    .toArray();
  if (newish.length === 0) return { entries: 0, items: 0 };

  const voucherIds = newish.map((v) => v.id);
  let entries = 0;
  let items = 0;
  let latest = childCursor;

  // Parallelize batches (cap concurrency) instead of strict sequential paging.
  const slices: string[][] = [];
  for (let i = 0; i < voucherIds.length; i += 200) slices.push(voucherIds.slice(i, i + 200));

  const CONCURRENCY = 4;

  if (opts.exact) {
    const allEntries: any[] = [];
    const allItems: any[] = [];
    let cursor = 0;
    async function worker() {
      while (cursor < slices.length) {
        const slice = slices[cursor++];
        const [{ data: eData, error: eErr }, { data: iData, error: iErr }] = await Promise.all([
          supabase.from("voucher_entries").select("*").in("voucher_id", slice),
          supabase.from("voucher_items").select("*").in("voucher_id", slice),
        ]);
        if (eErr) throw new Error(`voucher_entries: ${eErr.message}`);
        if (iErr) throw new Error(`voucher_items: ${iErr.message}`);
        allEntries.push(...(eData ?? []).map((r: any) => ({ ...r, company_id: companyId })));
        allItems.push(...(iData ?? []).map((r: any) => ({ ...r, company_id: companyId })));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker));
    await db.transaction("rw", db.cache_voucher_entries, db.cache_voucher_items, async () => {
      await db.cache_voucher_entries.where("company_id").equals(companyId).delete();
      await db.cache_voucher_items.where("company_id").equals(companyId).delete();
      if (allEntries.length) await db.cache_voucher_entries.bulkPut(allEntries as any);
      if (allItems.length) await db.cache_voucher_items.bulkPut(allItems as any);
    });
    entries = allEntries.length;
    items = allItems.length;
  } else {
    let cursor = 0;
    async function worker() {
      while (cursor < slices.length) {
        const slice = slices[cursor++];
      const [{ data: eData, error: eErr }, { data: iData, error: iErr }] = await Promise.all([
        supabase.from("voucher_entries").select("*").in("voucher_id", slice),
        supabase.from("voucher_items").select("*").in("voucher_id", slice),
      ]);
      if (eErr) throw new Error(`voucher_entries: ${eErr.message}`);
      if (iErr) throw new Error(`voucher_items: ${iErr.message}`);
      const entriesForCache = (eData ?? []).map((r: any) => ({ ...r, company_id: companyId }));
      const itemsForCache = (iData ?? []).map((r: any) => ({ ...r, company_id: companyId }));
      await db.cache_voucher_entries.where("voucher_id").anyOf(slice).delete();
      await db.cache_voucher_items.where("voucher_id").anyOf(slice).delete();
      if (entriesForCache.length) { await db.cache_voucher_entries.bulkPut(entriesForCache as any); entries += entriesForCache.length; }
      if (itemsForCache.length) { await db.cache_voucher_items.bulkPut(itemsForCache as any); items += itemsForCache.length; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker));
  }

  if (opts.exact) await pruneOrphanCachedChildren(db);

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
const perCompanyInFlight = new Map<string, Promise<SnapshotResult | null>>();

async function notifyOfflineReady(companyId: string, result: SnapshotResult) {
  if (typeof window === "undefined") return;
  try {
    const { toast } = await import("sonner");
    const errCount = Object.keys(result.errors).length;
    if (errCount === 0) {
      toast.success("All data available offline", {
        id: `offline-ready-${companyId}`,
        description: "You can now work without an internet connection.",
      });
    } else {
      toast.warning("Offline sync partially complete", {
        id: `offline-partial-${companyId}`,
        description: `${errCount} table(s) failed — retry will happen automatically.`,
      });
    }
  } catch { /* ignore */ }
}

export async function pullCompanySnapshot(
  companyId: string,
  opts: { full?: boolean; notify?: boolean } = {},
): Promise<SnapshotResult | null> {
  if (!isOnlineNow()) return null;
  const cacheKey = `${companyId}:${opts.full ? "full" : "min"}`;
  const existing = perCompanyInFlight.get(cacheKey);
  if (existing) return existing;

  const run = (async (): Promise<SnapshotResult | null> => {
    const ok = await pingOnline();
    if (!ok) return null;

    const result: SnapshotResult = { companyId, pulled: {}, errors: {}, finishedAt: 0 };
    const tables: readonly SnapshotTable[] = opts.full ? SNAPSHOT_TABLES : MINIMAL_TABLES;

    // Parallel table pulls — each table is independent. A full sync is an
    // exact mirror: local rows for this company are replaced by cloud rows,
    // so deleted/renamed online records cannot remain stale offline.
    await Promise.all(tables.map(async (table) => {
      try {
        result.pulled[table] = await pullTable(table, companyId, { exact: opts.full });
      } catch (e) {
        result.errors[table] = e instanceof Error ? e.message : String(e);
      }
    }));

    if (opts.full) {
      try {
        const { entries, items } = await pullVoucherChildren(companyId, { exact: true });
        result.pulled.voucher_entries = entries;
        result.pulled.voucher_items = items;
      } catch (e) {
        result.errors.voucher_children = e instanceof Error ? e.message : String(e);
      }
    }

    result.finishedAt = Date.now();
    const { setMeta } = await getDbInstance();
    await setMeta(`snapshot:last:${companyId}`, result);
    await setMeta("snapshot:last_any", result);

    if (opts.full && opts.notify !== false) await notifyOfflineReady(companyId, result);
    return result;
  })().finally(() => { perCompanyInFlight.delete(cacheKey); });

  perCompanyInFlight.set(cacheKey, run);
  return run;
}

/**
 * Background tick. Pulls ONLY the minimum dataset (companies +
 * company_settings) for every membership — enough to render the lock
 * screen and dashboard. Per-company heavy data is pulled on demand by
 * pullCompanySnapshot(id, { full: true }).
 */
export async function pullSnapshot(opts: { full?: boolean } = {}): Promise<SnapshotResult | null> {
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
      const results = await Promise.all(
        ids.map((id) => pullCompanySnapshot(id, { full: opts.full ?? false, notify: false }).catch(() => null)),
      );
      const completed = results.filter(Boolean) as SnapshotResult[];
      if (completed.length === 0) return null;
      if (opts.full) {
        return completed.reduce<SnapshotResult>((acc, r) => {
          for (const [k, v] of Object.entries(r.pulled)) acc.pulled[k] = (acc.pulled[k] ?? 0) + v;
          for (const [k, v] of Object.entries(r.errors)) acc.errors[`${r.companyId}:${k}`] = v;
          acc.finishedAt = Math.max(acc.finishedAt, r.finishedAt);
          return acc;
        }, { companyId: "all", pulled: {}, errors: {}, finishedAt: 0 });
      }
      return completed.pop() ?? null;
    } finally {
      pullInFlight = null;
    }
  })();
  return pullInFlight;
}

/** Row counts currently in the offline cache (not the last sync delta). */
export async function getOfflineCacheCounts(): Promise<Record<string, number>> {
  const { db } = await getDbInstance();
  const tables: Array<[string, any]> = [
    ["companies", db.cache_companies],
    ["company_settings", db.cache_company_settings],
    ["ledgers", db.cache_ledgers],
    ["items", db.cache_items],
    ["account_subgroups", db.cache_account_subgroups],
    ["ledger_group_mappings", db.cache_ledger_group_mappings],
    ["account_group_overrides", db.cache_account_group_overrides],
    ["vouchers", db.cache_vouchers],
    ["voucher_entries", db.cache_voucher_entries],
    ["voucher_items", db.cache_voucher_items],
    ["bill_allocations", db.cache_bill_allocations],
  ];
  const out: Record<string, number> = {};
  await Promise.all(tables.map(async ([k, t]) => {
    try { out[k] = await t.count(); } catch { out[k] = 0; }
  }));
  return out;
}

export async function getLastSnapshotResult(): Promise<SnapshotResult | null> {
  const { db } = await getDbInstance();
  const row = await db.meta.get("snapshot:last_any");
  return (row?.value as SnapshotResult) ?? null;
}

export async function resetSnapshotCache(): Promise<void> {
  const { db } = await getDbInstance();
  await db.transaction(
    "rw",
    [
      db.cache_companies,
      db.cache_company_settings,
      db.cache_ledgers,
      db.cache_items,
      db.cache_account_subgroups,
      db.cache_ledger_group_mappings,
      db.cache_account_group_overrides,
      db.cache_vouchers,
      db.cache_voucher_entries,
      db.cache_voucher_items,
      db.cache_bill_allocations,
      db.sync_cursors,
    ],
    async () => {
      await Promise.all([
        db.cache_companies.clear(),
        db.cache_company_settings.clear(),
        db.cache_ledgers.clear(),
        db.cache_items.clear(),
        db.cache_account_subgroups.clear(),
        db.cache_ledger_group_mappings.clear(),
        db.cache_account_group_overrides.clear(),
        db.cache_vouchers.clear(),
        db.cache_voucher_entries.clear(),
        db.cache_voucher_items.clear(),
        db.cache_bill_allocations.clear(),
        db.sync_cursors.clear(),
      ]);
    },
  );
}
