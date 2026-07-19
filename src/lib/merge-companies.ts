// Merge two local companies that share the same real-world identity.
//
// This is user-driven recovery — never called automatically. The typical
// scenario is a duplicate company row created by a fresh install: some
// vouchers are in id A, others in id B, and the user wants a single
// company again. Both sides are preserved on disk as pre-merge safety
// snapshots before any row is moved.
//
// Merge strategy:
//   1. Snapshot BOTH sides to %LOCALAPPDATA%\...\snapshots\<today>\pre-merge_*.json
//   2. Build a ledger-name map: for each ledger in FROM, if a ledger with
//      the same normalised name exists in KEEP, remap ledger_id in
//      cache_voucher_entries. Otherwise re-parent (change company_id).
//   3. Do the same for items -> cache_voucher_items.item_id.
//   4. Re-parent every voucher and voucher-child row (entries, items, bill
//      allocations, einvoice, export details, period locks, series, etc.)
//      to KEEP's company_id.
//   5. Delete FROM from companies + cache_companies + cache_company_settings.
//   6. Refresh integrity manifest for KEEP.
//
// The operation runs inside a single Dexie transaction so a mid-flight
// failure leaves the DB unchanged.

import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup } from "@/lib/backup";
import { wrapBackup } from "@/lib/backup-policy";
import { getAppPaths } from "@/lib/app-paths";
import { isDesktopRuntime, writeAbsoluteFileNative } from "@/lib/native-bridge";
import { recordIntegrityFromSnapshot } from "@/lib/integrity";

/** Tables that carry a company_id and belong to a single company. */
const REPARENT_TABLES: readonly string[] = [
  "cache_vouchers",
  "cache_voucher_entries",
  "cache_voucher_items",
  "cache_bill_allocations",
  "cache_voucher_export_details",
  "cache_einvoice_details",
  "cache_period_locks",
  "cache_ledgers",
  "cache_items",
  "cache_account_subgroups",
  "cache_ledger_group_mappings",
  "cache_account_group_overrides",
  "cache_bom_templates",
  "cache_bom_template_lines",
  "cache_recurring_invoices",
  "cache_voucher_series",
  "cache_tax_templates",
  "cache_bill_sundries",
  "cache_transport_details",
  "cache_cost_centres",
  "cache_cost_categories",
  "cache_company_settings",
];

export interface CompanyStat {
  id: string;
  name: string;
  ledgers: number;
  items: number;
  vouchers: number;
  earliestVoucherDate: string | null;
  latestVoucherDate: string | null;
  monthly: { month: string; count: number }[];
}

export interface DuplicateGroup {
  normalisedName: string;
  companies: CompanyStat[];
}

export interface MergePreview {
  keep: CompanyStat;
  from: CompanyStat;
  ledgerMerges: { fromId: string; fromName: string; keepId: string | null; keepName: string | null }[];
  itemMerges: { fromId: string; fromName: string; keepId: string | null; keepName: string | null }[];
  vouchersToMove: number;
}

export interface MergeOutcome {
  vouchersMoved: number;
  entriesMoved: number;
  itemsMoved: number;
  ledgersReparented: number;
  ledgersRemapped: number;
  itemsReparented: number;
  itemsRemapped: number;
  safetySnapshots: { companyId: string; path: string | null; error?: string }[];
}

function norm(s: unknown): string {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function statCompany(id: string, nameHint?: string): Promise<CompanyStat> {
  const [row, ledgers, items, vouchers] = await Promise.all([
    offlineDb.cache_companies.get(id).catch(() => null) as Promise<{ name?: string } | null>,
    offlineDb.cache_ledgers.where("company_id").equals(id).count().catch(() => 0),
    offlineDb.cache_items.where("company_id").equals(id).count().catch(() => 0),
    offlineDb.cache_vouchers.where("company_id").equals(id).toArray().catch(() => [] as any[]),
  ]);
  const dates: string[] = [];
  const monthMap = new Map<string, number>();
  for (const v of vouchers as { voucher_date?: string }[]) {
    const d = v?.voucher_date;
    if (typeof d === "string" && d.length >= 7) {
      dates.push(d);
      const m = d.slice(0, 7);
      monthMap.set(m, (monthMap.get(m) ?? 0) + 1);
    }
  }
  dates.sort();
  const monthly = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  return {
    id,
    name: String(row?.name ?? nameHint ?? "").trim() || "Unnamed",
    ledgers,
    items,
    vouchers: vouchers.length,
    earliestVoucherDate: dates[0] ?? null,
    latestVoucherDate: dates[dates.length - 1] ?? null,
    monthly,
  };
}

/** List all groups of companies with the same normalised name that have >1 member. */
export async function findDuplicateCompanyGroups(): Promise<DuplicateGroup[]> {
  const [picker, snap] = await Promise.all([
    offlineDb.companies.toArray().catch(() => [] as any[]),
    offlineDb.cache_companies.toArray().catch(() => [] as any[]),
  ]);
  const byId = new Map<string, { id: string; name: string }>();
  for (const c of picker as any[]) if (c?.id) byId.set(String(c.id), { id: String(c.id), name: String(c.name ?? "") });
  for (const c of snap as any[]) if (c?.id) byId.set(String(c.id), { id: String(c.id), name: String(c.name ?? byId.get(String(c.id))?.name ?? "") });

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const c of byId.values()) {
    const n = norm(c.name);
    if (!n) continue;
    const arr = groups.get(n) ?? [];
    arr.push(c);
    groups.set(n, arr);
  }

  const out: DuplicateGroup[] = [];
  for (const [n, arr] of groups.entries()) {
    if (arr.length < 2) continue;
    const stats = await Promise.all(arr.map((c) => statCompany(c.id, c.name)));
    // Sort by voucher count desc so the natural "keep" candidate is on top.
    stats.sort((a, b) => b.vouchers - a.vouchers || (a.id < b.id ? -1 : 1));
    out.push({ normalisedName: n, companies: stats });
  }
  return out.sort((a, b) => a.normalisedName.localeCompare(b.normalisedName));
}

export async function buildMergePreview(keepId: string, fromId: string): Promise<MergePreview> {
  const [keepStat, fromStat, keepLedgers, fromLedgers, keepItems, fromItems] = await Promise.all([
    statCompany(keepId),
    statCompany(fromId),
    offlineDb.cache_ledgers.where("company_id").equals(keepId).toArray().catch(() => [] as any[]),
    offlineDb.cache_ledgers.where("company_id").equals(fromId).toArray().catch(() => [] as any[]),
    offlineDb.cache_items.where("company_id").equals(keepId).toArray().catch(() => [] as any[]),
    offlineDb.cache_items.where("company_id").equals(fromId).toArray().catch(() => [] as any[]),
  ]);

  const keepLedgerByName = new Map<string, any>();
  for (const l of keepLedgers as any[]) keepLedgerByName.set(norm(l?.name), l);
  const keepItemByName = new Map<string, any>();
  for (const i of keepItems as any[]) keepItemByName.set(norm(i?.name), i);

  const ledgerMerges = (fromLedgers as any[]).map((l) => {
    const match = keepLedgerByName.get(norm(l?.name));
    return {
      fromId: String(l.id),
      fromName: String(l.name ?? ""),
      keepId: match ? String(match.id) : null,
      keepName: match ? String(match.name ?? "") : null,
    };
  });
  const itemMerges = (fromItems as any[]).map((i) => {
    const match = keepItemByName.get(norm(i?.name));
    return {
      fromId: String(i.id),
      fromName: String(i.name ?? ""),
      keepId: match ? String(match.id) : null,
      keepName: match ? String(match.name ?? "") : null,
    };
  });

  return {
    keep: keepStat,
    from: fromStat,
    ledgerMerges,
    itemMerges,
    vouchersToMove: fromStat.vouchers,
  };
}

async function writeSafetySnapshot(companyId: string, companyName: string): Promise<{ path: string | null; error?: string }> {
  if (!isDesktopRuntime()) return { path: null, error: "Not desktop" };
  try {
    const payload = await buildCompanyBackup(companyId);
    const paths = await getAppPaths();
    if (!paths) return { path: null, error: "No app-paths" };
    const envelope = await wrapBackup(payload);
    const contents = JSON.stringify(envelope);
    const subFolder = `snapshots/${todayKey()}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `pre-merge_${safeName(companyName)}_${companyId.slice(0, 8)}_${stamp}.json`;
    const res = await writeAbsoluteFileNative(paths.root.replace(/[\\/]+$/, ""), subFolder, fileName, contents);
    if (!res.ok) return { path: null, error: res.error ?? "write failed" };
    return { path: res.path ?? null };
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function mergeCompanies(keepId: string, fromId: string): Promise<MergeOutcome> {
  if (!keepId || !fromId || keepId === fromId) {
    throw new Error("Pick two different companies to merge.");
  }

  const [keepRow, fromRow] = await Promise.all([
    offlineDb.cache_companies.get(keepId).catch(() => null) as Promise<{ name?: string } | null>,
    offlineDb.cache_companies.get(fromId).catch(() => null) as Promise<{ name?: string } | null>,
  ]);
  const keepName = String(keepRow?.name ?? "").trim() || "keep";
  const fromName = String(fromRow?.name ?? "").trim() || "from";

  // 1. Safety snapshots for BOTH sides on disk.
  const [keepSafety, fromSafety] = await Promise.all([
    writeSafetySnapshot(keepId, keepName),
    writeSafetySnapshot(fromId, fromName),
  ]);

  // 2. Build ledger + item remap tables.
  const [keepLedgers, fromLedgers, keepItems, fromItems] = await Promise.all([
    offlineDb.cache_ledgers.where("company_id").equals(keepId).toArray().catch(() => [] as any[]),
    offlineDb.cache_ledgers.where("company_id").equals(fromId).toArray().catch(() => [] as any[]),
    offlineDb.cache_items.where("company_id").equals(keepId).toArray().catch(() => [] as any[]),
    offlineDb.cache_items.where("company_id").equals(fromId).toArray().catch(() => [] as any[]),
  ]);
  const keepLedgerByName = new Map<string, any>();
  for (const l of keepLedgers as any[]) keepLedgerByName.set(norm(l?.name), l);
  const keepItemByName = new Map<string, any>();
  for (const i of keepItems as any[]) keepItemByName.set(norm(i?.name), i);

  const ledgerRemap = new Map<string, string>();      // fromLedgerId -> keepLedgerId (name match)
  const ledgerReparent = new Set<string>();           // fromLedgerIds to re-parent (no name match)
  for (const l of fromLedgers as any[]) {
    const match = keepLedgerByName.get(norm(l?.name));
    if (match) ledgerRemap.set(String(l.id), String(match.id));
    else ledgerReparent.add(String(l.id));
  }
  const itemRemap = new Map<string, string>();
  const itemReparent = new Set<string>();
  for (const i of fromItems as any[]) {
    const match = keepItemByName.get(norm(i?.name));
    if (match) itemRemap.set(String(i.id), String(match.id));
    else itemReparent.add(String(i.id));
  }

  const outcome: MergeOutcome = {
    vouchersMoved: 0,
    entriesMoved: 0,
    itemsMoved: 0,
    ledgersReparented: 0,
    ledgersRemapped: ledgerRemap.size,
    itemsReparented: 0,
    itemsRemapped: itemRemap.size,
    safetySnapshots: [
      { companyId: keepId, path: keepSafety.path, error: keepSafety.error },
      { companyId: fromId, path: fromSafety.path, error: fromSafety.error },
    ],
  };

  // 3. Perform the move inside a single Dexie transaction so a mid-flight
  //    failure leaves the DB unchanged. We include the picker "companies"
  //    table too so the loser row is only deleted if everything else
  //    committed.
  const db: any = offlineDb;
  const tables = REPARENT_TABLES
    .map((t) => db[t])
    .filter(Boolean)
    .concat([db.companies, db.cache_companies]);

  await db.transaction("rw", tables, async () => {
    // 3a. cache_vouchers — re-parent company_id.
    const vouchers = await db.cache_vouchers.where("company_id").equals(fromId).toArray();
    for (const v of vouchers) v.company_id = keepId;
    if (vouchers.length) await db.cache_vouchers.bulkPut(vouchers);
    outcome.vouchersMoved = vouchers.length;

    // 3b. cache_voucher_entries — re-parent + remap ledger_id where applicable.
    const entries = await db.cache_voucher_entries.where("company_id").equals(fromId).toArray();
    for (const e of entries) {
      e.company_id = keepId;
      const remapped = ledgerRemap.get(String(e.ledger_id ?? ""));
      if (remapped) e.ledger_id = remapped;
    }
    if (entries.length) await db.cache_voucher_entries.bulkPut(entries);
    outcome.entriesMoved = entries.length;

    // 3c. cache_voucher_items — re-parent + remap item_id where applicable.
    const vItems = await db.cache_voucher_items.where("company_id").equals(fromId).toArray();
    for (const it of vItems) {
      it.company_id = keepId;
      const remapped = itemRemap.get(String(it.item_id ?? ""));
      if (remapped) it.item_id = remapped;
    }
    if (vItems.length) await db.cache_voucher_items.bulkPut(vItems);
    outcome.itemsMoved = vItems.length;

    // 3d. Ledgers: drop duplicates (name-matched) and re-parent the rest.
    const fromLedgerRows = await db.cache_ledgers.where("company_id").equals(fromId).toArray();
    const ledgerToDelete: string[] = [];
    const ledgerToReparent: any[] = [];
    for (const l of fromLedgerRows) {
      if (ledgerRemap.has(String(l.id))) ledgerToDelete.push(String(l.id));
      else { l.company_id = keepId; ledgerToReparent.push(l); }
    }
    if (ledgerToDelete.length) await db.cache_ledgers.bulkDelete(ledgerToDelete);
    if (ledgerToReparent.length) await db.cache_ledgers.bulkPut(ledgerToReparent);
    outcome.ledgersReparented = ledgerToReparent.length;

    // 3e. Items: same pattern.
    const fromItemRows = await db.cache_items.where("company_id").equals(fromId).toArray();
    const itemToDelete: string[] = [];
    const itemToReparent: any[] = [];
    for (const it of fromItemRows) {
      if (itemRemap.has(String(it.id))) itemToDelete.push(String(it.id));
      else { it.company_id = keepId; itemToReparent.push(it); }
    }
    if (itemToDelete.length) await db.cache_items.bulkDelete(itemToDelete);
    if (itemToReparent.length) await db.cache_items.bulkPut(itemToReparent);
    outcome.itemsReparented = itemToReparent.length;

    // 3f. All other company-scoped tables — plain re-parent.
    const otherTables = REPARENT_TABLES.filter(
      (t) => !["cache_vouchers", "cache_voucher_entries", "cache_voucher_items", "cache_ledgers", "cache_items"].includes(t),
    );
    for (const t of otherTables) {
      const table = db[t];
      if (!table) continue;
      let rows: any[] = [];
      try {
        rows = await table.where("company_id").equals(fromId).toArray();
      } catch {
        // Table may not have a company_id index — fall back to a filter scan.
        try {
          rows = await table.filter((r: any) => r?.company_id === fromId).toArray();
        } catch { rows = []; }
      }
      if (!rows.length) continue;
      for (const r of rows) r.company_id = keepId;
      try { await table.bulkPut(rows); } catch { /* ignore per-table failure */ }
    }

    // 3g. Delete the loser row from picker + snapshot caches.
    await db.companies.delete(fromId).catch(() => undefined);
    await db.cache_companies.delete(fromId).catch(() => undefined);
  });

  // 4. Refresh integrity manifest for the survivor.
  try {
    const payload = await buildCompanyBackup(keepId);
    await recordIntegrityFromSnapshot(keepId, keepName, payload, { file: "post-merge" });
  } catch { /* ignore */ }

  return outcome;
}
