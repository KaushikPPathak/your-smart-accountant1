// Opt-in "Rebuild cache from server" flow.
//
// This is deliberately NOT automatic — nuking the local cache in an
// app that supports local-only companies would violate the
// local-data-permanent constraint. It runs only from the Data Health
// screen, only per-company, and only when there is no pending outbox
// work for that company.

import { offlineDb } from "./db";
import { pullCompanySnapshot } from "./snapshot";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { stampSchemaVersion } from "./schema-version";

export interface RebuildGuardReason {
  ok: false;
  reason: string;
}
export interface RebuildOk {
  ok: true;
}
export type RebuildGuard = RebuildOk | RebuildGuardReason;

/** Preflight checks. Refuse in local-only mode or when outbox has queued work. */
export async function checkCanRebuild(companyId: string): Promise<RebuildGuard> {
  if (!companyId) return { ok: false, reason: "No active company." };
  if (isLocalOnlyMode()) {
    return {
      ok: false,
      reason: "Local-only mode is on — the server has no copy to rebuild from. Turn on cloud sync first.",
    };
  }
  const pending = await offlineDb.outbox
    .filter((r: any) => r?.company_id === companyId)
    .count()
    .catch(() => 0);
  if (pending > 0) {
    return {
      ok: false,
      reason: `${pending} unsynced change(s) are queued for this company. Wait for sync to finish before rebuilding.`,
    };
  }
  // Guard: if a locked period exists, rebuild must go through a full server
  // refetch. That's already what this function does, but we also refuse if
  // any period-lock audit rows are queued for sync (avoid data drift).
  try {
    const auditQueued = await offlineDb.outbox
      .filter((r: any) => {
        const t = String(r?.table_name ?? r?.table ?? "");
        return t === "period_lock_audit" || t === "voucher_repair_audit";
      })
      .count();
    if (auditQueued > 0) {
      return {
        ok: false,
        reason: "Audit-log entries are still syncing. Try again in a moment.",
      };
    }
  } catch { /* ignore */ }
  return { ok: true };
}

/** The list of tables the rebuild clears. Notably excludes outbox / dead_letter / account_creds / meta / companies picker. */
const CACHE_TABLES: readonly string[] = [
  "cache_companies",
  "cache_company_settings",
  "cache_ledgers",
  "cache_items",
  "cache_account_subgroups",
  "cache_ledger_group_mappings",
  "cache_account_group_overrides",
  "cache_vouchers",
  "cache_voucher_entries",
  "cache_voucher_items",
  "cache_bill_allocations",
  "cache_voucher_export_details",
  "cache_einvoice_details",
  "cache_period_locks",
  "cache_bom_templates",
  "cache_bom_template_lines",
  "cache_recurring_invoices",
  "cache_voucher_series",
  "cache_tax_templates",
  "cache_bill_sundries",
  "cache_transport_details",
  "cache_cost_centres",
  "cache_cost_categories",
];

async function clearCompanyRowsFromTable(tableName: string, companyId: string) {
  const table = (offlineDb as any)[tableName];
  if (!table) return;
  try {
    await table.where("company_id").equals(companyId).delete();
  } catch {
    // Some tables (cache_voucher_entries / _items in old versions) may
    // not have a company_id index. Fall back to a filter delete.
    try {
      const rows = await table.filter((r: any) => r?.company_id === companyId).toArray();
      const ids = rows.map((r: any) => r.id).filter((x: unknown) => x != null);
      if (ids.length) await table.bulkDelete(ids);
    } catch { /* ignore */ }
  }
}

export interface RebuildResult {
  cleared: number;
  fetchedTables: number;
}

/** Clears cached rows for the given company, resets exact-done marker, then triggers a full snapshot pull. */
export async function rebuildCompanyCache(companyId: string): Promise<RebuildResult> {
  const guard = await checkCanRebuild(companyId);
  if (!guard.ok) throw new Error(guard.reason);

  let cleared = 0;
  for (const t of CACHE_TABLES) {
    const before = await (offlineDb as any)[t]?.count?.().catch(() => 0);
    await clearCompanyRowsFromTable(t, companyId);
    const after = await (offlineDb as any)[t]?.count?.().catch(() => 0);
    cleared += Math.max(0, (before ?? 0) - (after ?? 0));
  }

  // Reset snapshot cursors for this company so the next pull is exact, not delta.
  try {
    await offlineDb.sync_cursors.filter((r: any) => r?.company_id === companyId).delete();
  } catch { /* ignore */ }
  try {
    await offlineDb.meta.delete(`snapshot:exact_done:${companyId}`);
  } catch { /* ignore */ }

  const result = await pullCompanySnapshot(companyId, { full: true, forceExact: true });
  const fetchedTables = result && result.pulled ? Object.keys(result.pulled).length : 0;
  await stampSchemaVersion();
  return { cleared, fetchedTables };
}
