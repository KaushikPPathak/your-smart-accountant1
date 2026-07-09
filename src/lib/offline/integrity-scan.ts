// Batched, non-blocking integrity scan.
//
// Design goals (per user requirement):
//   - Never runs in the background during normal work.
//   - Only invoked from Data Health, before backup, before restore,
//     or once after a schema-version upgrade.
//   - Processes rows in batches of BATCH_SIZE and yields to the event
//     loop between batches so the UI stays responsive.
//   - Uses indexed queries (`where("company_id").equals(...)`) to avoid
//     full-table scans across other companies' data.
//   - Reports progress via an optional callback.

import { offlineDb } from "./db";

export const BATCH_SIZE = 800;

export interface IntegrityIssue {
  table: string;
  issue: string;
  count: number;
}

export interface ScanProgress {
  phase: string;
  processed: number;
  total: number;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

async function scanTableBatched<T>(
  table: any,
  companyId: string,
  visit: (row: T) => void,
  phase: string,
  opts: ScanOptions,
): Promise<number> {
  // Uses the compound/single index on company_id — no full-table scan.
  const coll = table.where("company_id").equals(companyId);
  const total = await coll.count();
  let processed = 0;
  let offset = 0;
  while (offset < total) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const chunk: T[] = await coll.offset(offset).limit(BATCH_SIZE).toArray();
    for (const row of chunk) visit(row);
    processed += chunk.length;
    offset += chunk.length;
    opts.onProgress?.({ phase, processed, total });
    await yieldToUi();
    if (chunk.length < BATCH_SIZE) break;
  }
  return total;
}

export async function runIntegrityScan(
  companyId: string,
  opts: ScanOptions = {},
): Promise<IntegrityIssue[]> {
  const counts = {
    companyGstinNoFlag: 0,
    companyNoState: 0,
    companyNoFy: 0,
    ledgerNoGroup: 0,
    ledgerGstinNoTreatment: 0,
    itemNoHsn: 0,
    itemNoRate: 0,
    voucherWithoutEntries: 0,
    entryUnknownLedger: 0,
    orphanAllocation: 0,
  };

  // 1) Companies (single row lookup — no batching needed).
  const companies: any[] = await offlineDb.cache_companies
    .filter((r: any) => r?.id === companyId)
    .toArray()
    .catch(() => []);
  for (const c of companies) {
    if (c?.gstin && !c?.gst_registered) counts.companyGstinNoFlag++;
    if (!c?.state_code) counts.companyNoState++;
    if (!c?.financial_year_start) counts.companyNoFy++;
  }

  // 2) Ledgers — build the active-id set as we go (needed for entry check).
  const activeLedgerIds = new Set<string>();
  await scanTableBatched<any>(
    offlineDb.cache_ledgers,
    companyId,
    (l) => {
      if (l?.is_deleted !== true) activeLedgerIds.add(String(l.id));
      if (!l?.group_id) counts.ledgerNoGroup++;
      if (l?.gstin && !l?.gst_treatment) counts.ledgerGstinNoTreatment++;
    },
    "Ledgers",
    opts,
  );

  // 3) Items.
  await scanTableBatched<any>(
    offlineDb.cache_items,
    companyId,
    (i) => {
      if (i?.is_deleted === true) return;
      if (!i?.hsn_code) counts.itemNoHsn++;
      if (i?.gst_rate == null) counts.itemNoRate++;
    },
    "Items",
    opts,
  );

  // 4) Vouchers — collect live voucher ids for orphan-child detection.
  const liveVoucherIds = new Set<string>();
  const voucherIdsNeedingEntries = new Set<string>();
  await scanTableBatched<any>(
    offlineDb.cache_vouchers,
    companyId,
    (v) => {
      if (v?.is_deleted === true) return;
      liveVoucherIds.add(String(v.id));
      voucherIdsNeedingEntries.add(String(v.id));
    },
    "Vouchers",
    opts,
  );

  // 5) Voucher entries.
  await scanTableBatched<any>(
    offlineDb.cache_voucher_entries,
    companyId,
    (e) => {
      voucherIdsNeedingEntries.delete(String(e.voucher_id));
      if (e?.ledger_id && !activeLedgerIds.has(String(e.ledger_id))) counts.entryUnknownLedger++;
    },
    "Voucher entries",
    opts,
  );
  counts.voucherWithoutEntries = voucherIdsNeedingEntries.size;

  // 6) Bill allocations.
  await scanTableBatched<any>(
    offlineDb.cache_bill_allocations,
    companyId,
    (a) => {
      if (a?.invoice_voucher_id && !liveVoucherIds.has(String(a.invoice_voucher_id))) counts.orphanAllocation++;
    },
    "Bill allocations",
    opts,
  );

  return [
    { table: "Companies", issue: "gst_registered=false but GSTIN present", count: counts.companyGstinNoFlag },
    { table: "Companies", issue: "missing state_code", count: counts.companyNoState },
    { table: "Companies", issue: "missing financial_year_start", count: counts.companyNoFy },
    { table: "Ledgers", issue: "missing group_id", count: counts.ledgerNoGroup },
    { table: "Ledgers", issue: "GSTIN present but no gst_treatment", count: counts.ledgerGstinNoTreatment },
    { table: "Items", issue: "missing hsn_code", count: counts.itemNoHsn },
    { table: "Items", issue: "gst_rate is null/undefined", count: counts.itemNoRate },
    { table: "Vouchers", issue: "without any voucher_entries", count: counts.voucherWithoutEntries },
    { table: "Voucher entries", issue: "reference deleted/unknown ledger", count: counts.entryUnknownLedger },
    { table: "Bill allocations", issue: "orphaned (invoice voucher missing)", count: counts.orphanAllocation },
  ];
}

/** Total issue count across all invariants. */
export function totalIssues(issues: IntegrityIssue[]): number {
  return issues.reduce((s, i) => s + i.count, 0);
}
