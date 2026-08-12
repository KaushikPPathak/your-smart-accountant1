// Recovery utility — transfer only vouchers dated AFTER a cutoff from a
// source company into a target company. Used by the Recovery Wizard step
// 2, so the user can:
//   1. Restore the clean pre-reinstall backup into a new company (via
//      restore-into-new-company.ts), and then
//   2. Pull the *genuinely new* post-cutoff vouchers from the current
//      (possibly duplicated) company into the freshly restored copy.
//
// Guarantees:
//   * Never touches source data — read-only against `sourceCompanyId`.
//   * Ledgers are matched into the target by case-insensitive trimmed
//     name. Missing ledgers are cloned (with a fresh id) preserving
//     group / type / opening balance fields.
//   * Items are matched similarly and cloned if missing (only when
//     referenced by a transferring voucher_item).
//   * Vouchers already present in the target with the same
//     (voucher_date, voucher_type, voucher_number) are skipped as
//     duplicates.
//   * All writes happen inside a single Dexie transaction so a crash
//     mid-transfer rolls back cleanly.

import { offlineDb } from "@/lib/offline/db";

function newId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const raw = c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${raw}`;
}

const nameKey = (s: unknown): string => String(s ?? "").trim().toLowerCase();

export interface DateSlicePreview {
  sourceVouchers: number;
  postCutoff: number;
  duplicates: number;
  missingLedgers: number;
  missingItems: number;
  cutoffDate: string;
}

export interface DateSliceResult {
  transferred: number;
  skippedDuplicates: number;
  ledgersCreated: number;
  itemsCreated: number;
  entries: number;
  voucherItems: number;
  billAllocations: number;
}

async function loadContext(
  sourceCompanyId: string,
  targetCompanyId: string,
  cutoffISO: string,
) {
  const [srcVouchers, tgtVouchers, srcLedgers, tgtLedgers, srcItems, tgtItems] =
    await Promise.all([
      offlineDb.cache_vouchers.where("company_id").equals(sourceCompanyId).toArray(),
      offlineDb.cache_vouchers.where("company_id").equals(targetCompanyId).toArray(),
      offlineDb.cache_ledgers.where("company_id").equals(sourceCompanyId).toArray(),
      offlineDb.cache_ledgers.where("company_id").equals(targetCompanyId).toArray(),
      offlineDb.cache_items.where("company_id").equals(sourceCompanyId).toArray(),
      offlineDb.cache_items.where("company_id").equals(targetCompanyId).toArray(),
    ]);

  const postCutoffVouchers = (srcVouchers as Record<string, unknown>[]).filter((v) => {
    const d = String(v.voucher_date ?? "");
    return d && d > cutoffISO;
  });

  return { srcVouchers, tgtVouchers, srcLedgers, tgtLedgers, srcItems, tgtItems, postCutoffVouchers };
}

function buildDupSet(tgtVouchers: Record<string, unknown>[]): Set<string> {
  const s = new Set<string>();
  for (const v of tgtVouchers) {
    const key = `${v.voucher_date}|${v.voucher_type}|${String(v.voucher_number ?? "").trim()}`;
    s.add(key);
  }
  return s;
}

export async function previewDateSliceTransfer(
  sourceCompanyId: string,
  targetCompanyId: string,
  cutoffISO: string,
): Promise<DateSlicePreview> {
  const ctx = await loadContext(sourceCompanyId, targetCompanyId, cutoffISO);
  const dup = buildDupSet(ctx.tgtVouchers as Record<string, unknown>[]);
  const tgtLedgerByName = new Map<string, string>();
  for (const l of ctx.tgtLedgers as Record<string, unknown>[]) {
    tgtLedgerByName.set(nameKey(l.name), String(l.id));
  }
  const tgtItemByName = new Map<string, string>();
  for (const it of ctx.tgtItems as Record<string, unknown>[]) {
    tgtItemByName.set(nameKey(it.name), String(it.id));
  }

  const postIds = new Set(ctx.postCutoffVouchers.map((v) => String(v.id)));
  const entries = await offlineDb.cache_voucher_entries
    .where("company_id").equals(sourceCompanyId).toArray();
  const items = await offlineDb.cache_voucher_items
    .where("company_id").equals(sourceCompanyId).toArray();

  const srcLedgerById = new Map<string, Record<string, unknown>>();
  for (const l of ctx.srcLedgers as Record<string, unknown>[]) srcLedgerById.set(String(l.id), l);
  const srcItemById = new Map<string, Record<string, unknown>>();
  for (const it of ctx.srcItems as Record<string, unknown>[]) srcItemById.set(String(it.id), it);

  const missingLedgerIds = new Set<string>();
  for (const e of entries as Record<string, unknown>[]) {
    if (!postIds.has(String(e.voucher_id))) continue;
    const lid = String(e.ledger_id ?? "");
    const src = srcLedgerById.get(lid);
    if (!src) continue;
    if (!tgtLedgerByName.has(nameKey(src.name))) missingLedgerIds.add(lid);
  }
  const missingItemIds = new Set<string>();
  for (const it of items as Record<string, unknown>[]) {
    if (!postIds.has(String(it.voucher_id))) continue;
    const iid = String(it.item_id ?? "");
    const src = srcItemById.get(iid);
    if (!src) continue;
    if (!tgtItemByName.has(nameKey(src.name))) missingItemIds.add(iid);
  }

  let duplicates = 0;
  for (const v of ctx.postCutoffVouchers) {
    const k = `${v.voucher_date}|${v.voucher_type}|${String(v.voucher_number ?? "").trim()}`;
    if (dup.has(k)) duplicates += 1;
  }

  return {
    sourceVouchers: ctx.srcVouchers.length,
    postCutoff: ctx.postCutoffVouchers.length,
    duplicates,
    missingLedgers: missingLedgerIds.size,
    missingItems: missingItemIds.size,
    cutoffDate: cutoffISO,
  };
}

export async function runDateSliceTransfer(
  sourceCompanyId: string,
  targetCompanyId: string,
  cutoffISO: string,
): Promise<DateSliceResult> {
  if (sourceCompanyId === targetCompanyId) {
    throw new Error("Source and target companies must be different.");
  }
  const ctx = await loadContext(sourceCompanyId, targetCompanyId, cutoffISO);
  const dupSet = buildDupSet(ctx.tgtVouchers as Record<string, unknown>[]);

  const [srcEntries, srcItems, srcAllocations] = await Promise.all([
    offlineDb.cache_voucher_entries.where("company_id").equals(sourceCompanyId).toArray(),
    offlineDb.cache_voucher_items.where("company_id").equals(sourceCompanyId).toArray(),
    offlineDb.cache_bill_allocations.where("company_id").equals(sourceCompanyId).toArray(),
  ]);

  // Index by source id for O(1) lookup while walking children.
  const srcLedgerById = new Map<string, Record<string, unknown>>();
  for (const l of ctx.srcLedgers as Record<string, unknown>[]) srcLedgerById.set(String(l.id), l);
  const srcItemById = new Map<string, Record<string, unknown>>();
  for (const it of ctx.srcItems as Record<string, unknown>[]) srcItemById.set(String(it.id), it);

  const tgtLedgerByName = new Map<string, string>();
  for (const l of ctx.tgtLedgers as Record<string, unknown>[]) {
    tgtLedgerByName.set(nameKey(l.name), String(l.id));
  }
  const tgtItemByName = new Map<string, string>();
  for (const it of ctx.tgtItems as Record<string, unknown>[]) {
    tgtItemByName.set(nameKey(it.name), String(it.id));
  }

  // Decide which vouchers actually transfer (post-cutoff and not a dup).
  const transferring: Record<string, unknown>[] = [];
  let skippedDuplicates = 0;
  for (const v of ctx.postCutoffVouchers) {
    const k = `${v.voucher_date}|${v.voucher_type}|${String(v.voucher_number ?? "").trim()}`;
    if (dupSet.has(k)) { skippedDuplicates += 1; continue; }
    transferring.push(v);
  }
  const transferringIds = new Set(transferring.map((v) => String(v.id)));

  // Voucher id remap: source id → new target id
  const voucherIdMap = new Map<string, string>();
  for (const v of transferring) {
    voucherIdMap.set(String(v.id), newId(`local:${targetCompanyId}:voucher`));
  }

  // Ledger remap: any source ledger referenced by a transferring entry
  // (or as party_ledger_id on a transferring voucher) that's absent in
  // the target gets cloned.
  const ledgerIdMap = new Map<string, string>();
  const newLedgerRows: Record<string, unknown>[] = [];

  const resolveLedger = (sourceLedgerId: string | null | undefined): string | null => {
    if (!sourceLedgerId) return null;
    const cached = ledgerIdMap.get(sourceLedgerId);
    if (cached) return cached;
    const src = srcLedgerById.get(sourceLedgerId);
    if (!src) return null;
    const existing = tgtLedgerByName.get(nameKey(src.name));
    if (existing) {
      ledgerIdMap.set(sourceLedgerId, existing);
      return existing;
    }
    const cloneId = newId(`local:${targetCompanyId}:ledger`);
    ledgerIdMap.set(sourceLedgerId, cloneId);
    const nowIso = new Date().toISOString();
    newLedgerRows.push({
      ...src,
      id: cloneId,
      company_id: targetCompanyId,
      updated_at: nowIso,
      is_synced: true,
    });
    tgtLedgerByName.set(nameKey(src.name), cloneId);
    return cloneId;
  };

  const itemIdMap = new Map<string, string>();
  const newItemRows: Record<string, unknown>[] = [];
  const resolveItem = (sourceItemId: string | null | undefined): string | null => {
    if (!sourceItemId) return null;
    const cached = itemIdMap.get(sourceItemId);
    if (cached) return cached;
    const src = srcItemById.get(sourceItemId);
    if (!src) return null;
    const existing = tgtItemByName.get(nameKey(src.name));
    if (existing) {
      itemIdMap.set(sourceItemId, existing);
      return existing;
    }
    const cloneId = newId(`local:${targetCompanyId}:item`);
    itemIdMap.set(sourceItemId, cloneId);
    newItemRows.push({
      ...src,
      id: cloneId,
      company_id: targetCompanyId,
      updated_at: new Date().toISOString(),
      is_synced: true,
    });
    tgtItemByName.set(nameKey(src.name), cloneId);
    return cloneId;
  };

  // Build new voucher / entry / item / allocation rows.
  const nowIso = new Date().toISOString();
  const newVoucherRows: Record<string, unknown>[] = transferring.map((v) => {
    const newVid = voucherIdMap.get(String(v.id))!;
    const partyId = v.party_ledger_id ? resolveLedger(String(v.party_ledger_id)) : null;
    return {
      ...v,
      id: newVid,
      company_id: targetCompanyId,
      party_ledger_id: partyId,
      original_voucher_id: null,
      linked_voucher_ids: null,
      updated_at: nowIso,
      is_synced: true,
    };
  });

  const newEntryRows: Record<string, unknown>[] = [];
  for (const e of srcEntries as Record<string, unknown>[]) {
    const sourceVid = String(e.voucher_id ?? "");
    if (!transferringIds.has(sourceVid)) continue;
    const targetVid = voucherIdMap.get(sourceVid)!;
    const targetLid = resolveLedger(String(e.ledger_id ?? ""));
    if (!targetLid) continue; // orphan entry — skip safely
    newEntryRows.push({
      ...e,
      id: newId(`local:${targetCompanyId}:entry`),
      voucher_id: targetVid,
      ledger_id: targetLid,
      company_id: targetCompanyId,
      updated_at: nowIso,
      is_synced: true,
    });
  }

  const newItemRowsForVouchers: Record<string, unknown>[] = [];
  for (const it of srcItems as Record<string, unknown>[]) {
    const sourceVid = String(it.voucher_id ?? "");
    if (!transferringIds.has(sourceVid)) continue;
    const targetVid = voucherIdMap.get(sourceVid)!;
    const targetItemId = it.item_id ? resolveItem(String(it.item_id)) : null;
    newItemRowsForVouchers.push({
      ...it,
      id: newId(`local:${targetCompanyId}:voucher-item`),
      voucher_id: targetVid,
      item_id: targetItemId,
      company_id: targetCompanyId,
      updated_at: nowIso,
      is_synced: true,
    });
  }

  const newAllocRows: Record<string, unknown>[] = [];
  for (const a of srcAllocations as Record<string, unknown>[]) {
    const invVid = a.invoice_voucher_id ? String(a.invoice_voucher_id) : null;
    const payVid = a.payment_voucher_id ? String(a.payment_voucher_id) : null;
    // Only carry allocations where at least one side is being transferred.
    if (!(invVid && transferringIds.has(invVid)) && !(payVid && transferringIds.has(payVid))) continue;
    newAllocRows.push({
      ...a,
      id: newId(`local:${targetCompanyId}:allocation`),
      invoice_voucher_id: invVid && transferringIds.has(invVid) ? voucherIdMap.get(invVid)! : null,
      payment_voucher_id: payVid && transferringIds.has(payVid) ? voucherIdMap.get(payVid)! : null,
      ledger_id: a.ledger_id ? resolveLedger(String(a.ledger_id)) : null,
      company_id: targetCompanyId,
      updated_at: nowIso,
      is_synced: true,
    });
  }

  const tables = [
    offlineDb.cache_ledgers,
    offlineDb.cache_items,
    offlineDb.cache_vouchers,
    offlineDb.cache_voucher_entries,
    offlineDb.cache_voucher_items,
    offlineDb.cache_bill_allocations,
  ];

  await offlineDb.transaction("rw", tables, async () => {
    if (newLedgerRows.length) await offlineDb.cache_ledgers.bulkPut(newLedgerRows);
    if (newItemRows.length) await offlineDb.cache_items.bulkPut(newItemRows);
    if (newVoucherRows.length) await offlineDb.cache_vouchers.bulkPut(newVoucherRows);
    if (newEntryRows.length) await offlineDb.cache_voucher_entries.bulkPut(newEntryRows);
    if (newItemRowsForVouchers.length) await offlineDb.cache_voucher_items.bulkPut(newItemRowsForVouchers);
    if (newAllocRows.length) await offlineDb.cache_bill_allocations.bulkPut(newAllocRows);
  });

  return {
    transferred: newVoucherRows.length,
    skippedDuplicates,
    ledgersCreated: newLedgerRows.length,
    itemsCreated: newItemRows.length,
    entries: newEntryRows.length,
    voucherItems: newItemRowsForVouchers.length,
    billAllocations: newAllocRows.length,
  };
}
