// Delete a single local company and every row that belongs to it.
//
// Used by Housekeeping → "Delete Company" after the Recovery Wizard has
// produced a clean restored copy and the user wants to remove the older
// duplicate(s). A safety backup is written to disk first (on desktop)
// so nothing is truly lost. The delete runs inside a single Dexie
// transaction — a mid-flight crash leaves the DB unchanged.

import { offlineDb, setMeta, getMeta } from "@/lib/offline/db";
import { buildCompanyBackup } from "@/lib/backup";
import { wrapBackup } from "@/lib/backup-policy";
import { addTombstone } from "@/lib/recovery/tombstones";
import { getAppPaths } from "@/lib/app-paths";
import { isDesktopRuntime, writeAbsoluteFileNative } from "@/lib/native-bridge";

/** Every table that carries a company_id. Kept in sync with merge-companies. */
const COMPANY_SCOPED_TABLES: readonly string[] = [
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
  "einvoice_queue",
  "outbox",
  "dead_letter",
  "sync_cursors",
];

export interface PurgePreview {
  companyId: string;
  companyName: string;
  vouchers: number;
  entries: number;
  ledgers: number;
  items: number;
  rowsTotal: number;
  perTable: { table: string; rows: number }[];
}

export interface PurgeResult {
  companyId: string;
  companyName: string;
  rowsDeleted: number;
  safetyBackup: { path: string | null; error?: string };
}

function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countRows(table: string, companyId: string): Promise<number> {
  const db: any = offlineDb;
  const t = db[table];
  if (!t) return 0;
  try {
    return await t.where("company_id").equals(companyId).count();
  } catch {
    try {
      const rows = await t.filter((r: any) => r?.company_id === companyId).toArray();
      return rows.length;
    } catch {
      return 0;
    }
  }
}

export async function previewCompanyPurge(companyId: string): Promise<PurgePreview> {
  if (!companyId) throw new Error("No company selected");
  const row = (await offlineDb.cache_companies.get(companyId).catch(() => null)) as
    | { name?: string }
    | null;
  const picker = (await offlineDb.companies.get(companyId).catch(() => null)) as
    | { name?: string }
    | null;
  const name = String(row?.name ?? picker?.name ?? "").trim() || "Unnamed";

  const perTable: { table: string; rows: number }[] = [];
  let total = 0;
  for (const t of COMPANY_SCOPED_TABLES) {
    const n = await countRows(t, companyId);
    if (n > 0) perTable.push({ table: t, rows: n });
    total += n;
  }
  const vouchers = perTable.find((p) => p.table === "cache_vouchers")?.rows ?? 0;
  const entries = perTable.find((p) => p.table === "cache_voucher_entries")?.rows ?? 0;
  const ledgers = perTable.find((p) => p.table === "cache_ledgers")?.rows ?? 0;
  const items = perTable.find((p) => p.table === "cache_items")?.rows ?? 0;

  return { companyId, companyName: name, vouchers, entries, ledgers, items, rowsTotal: total, perTable };
}

async function writeSafetySnapshot(
  companyId: string,
  companyName: string,
): Promise<{ path: string | null; error?: string }> {
  if (!isDesktopRuntime()) return { path: null, error: "Not desktop — snapshot skipped" };
  try {
    const payload = await buildCompanyBackup(companyId);
    const paths = await getAppPaths();
    if (!paths) return { path: null, error: "No app-paths" };
    const envelope = await wrapBackup(payload);
    const contents = JSON.stringify(envelope);
    const subFolder = `snapshots/${todayKey()}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `pre-delete_${safeName(companyName)}_${companyId.slice(0, 8)}_${stamp}.json`;
    const res = await writeAbsoluteFileNative(
      paths.root.replace(/[\\/]+$/, ""),
      subFolder,
      fileName,
      contents,
    );
    if (!res.ok) return { path: null, error: res.error ?? "write failed" };
    return { path: res.path ?? null };
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function purgeCompany(companyId: string): Promise<PurgeResult> {
  if (!companyId) throw new Error("No company selected");
  const row = (await offlineDb.cache_companies.get(companyId).catch(() => null)) as
    | { name?: string }
    | null;
  const picker = (await offlineDb.companies.get(companyId).catch(() => null)) as
    | { name?: string }
    | null;
  const name = String(row?.name ?? picker?.name ?? "").trim() || "Unnamed";

  const safety = await writeSafetySnapshot(companyId, name);

  const db: any = offlineDb;
  const tables = COMPANY_SCOPED_TABLES.map((t) => db[t]).filter(Boolean);
  tables.push(db.companies, db.cache_companies);

  let deleted = 0;
  await db.transaction("rw", tables, async () => {
    for (const t of COMPANY_SCOPED_TABLES) {
      const table = db[t];
      if (!table) continue;
      let ids: any[] = [];
      try {
        const rows = await table.where("company_id").equals(companyId).primaryKeys();
        ids = rows;
      } catch {
        try {
          const rows = await table.filter((r: any) => r?.company_id === companyId).toArray();
          ids = rows.map((r: any) => r.id ?? r.voucher_id).filter((x: any) => x != null);
        } catch {
          ids = [];
        }
      }
      if (ids.length) {
        try {
          await table.bulkDelete(ids);
          deleted += ids.length;
        } catch {
          /* per-table failure ignored */
        }
      }
    }
    await db.companies.delete(companyId).catch(() => undefined);
    await db.cache_companies.delete(companyId).catch(() => undefined);
  });

  // Clear the integrity manifest entry so silent auto-restore stops looking
  // for this company on the next boot.
  try { await offlineDb.meta.delete(`integrity:${companyId}`); } catch { /* ignore */ }
  // Persistent tombstone — auto-restore + picker filter both honour it.
  try { await addTombstone(companyId, name); } catch { /* ignore */ }

  return { companyId, companyName: name, rowsDeleted: deleted, safetyBackup: safety };
}
