// Income-tax audit data for the local-only build: fixed-asset blocks, asset
// movements, manual disallowances and 43B clearances. Stored in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { newId } from "@/lib/utils/sys-utils";
import type { ItAsset, ItMovement } from "@/lib/tax-audit";

export interface ManualDisallowance {
  id: string;
  section: string;
  description: string;
  amount_paise: number;
}

export interface Clearance {
  cleared_on: string | null;
  cleared_paise: number;
  reference: string | null;
}

const clearanceKey = (companyId: string, ledgerId: string, fyEnd: string) => `${companyId}|${ledgerId}|${fyEnd}`;
const notDeleted = (r: any) => r?.is_deleted !== true && !r?.deleted_at;

export async function listFixedAssetsLocal(companyId: string, fyStart: string): Promise<ItAsset[]> {
  const rows: any[] = await db.cache_it_fixed_assets.where("[company_id+fy_start]").equals([companyId, fyStart]).toArray();
  return rows.map((r) => ({
    id: String(r.id),
    company_id: String(r.company_id),
    block_code: String(r.block_code),
    ledger_id: r.ledger_id ?? null,
    name: String(r.name ?? ""),
    fy_start: String(r.fy_start),
    opening_wdv_paise: Number(r.opening_wdv_paise) || 0,
  }));
}

export async function listMovementsLocal(companyId: string, fyStart: string): Promise<ItMovement[]> {
  const rows: any[] = await db.cache_it_asset_movements.where("[company_id+fy_start]").equals([companyId, fyStart]).toArray();
  return rows.map((r) => ({
    id: String(r.id),
    asset_id: String(r.asset_id),
    fy_start: String(r.fy_start),
    kind: r.kind as "addition" | "deletion",
    movement_date: String(r.movement_date),
    amount_paise: Number(r.amount_paise) || 0,
    notes: r.notes ?? null,
  }));
}

export async function listDisallowancesLocal(companyId: string, fyEnd: string): Promise<ManualDisallowance[]> {
  const rows: any[] = await db.cache_it_disallowances.where("[company_id+fy_end]").equals([companyId, fyEnd]).toArray();
  return rows.map((r) => ({
    id: String(r.id),
    section: String(r.section ?? ""),
    description: String(r.description ?? ""),
    amount_paise: Number(r.amount_paise) || 0,
  }));
}

/** 43B clearances for a period, keyed by ledger id. */
export async function listClearancesLocal(companyId: string, fyEnd: string): Promise<Map<string, Clearance>> {
  const rows: any[] = await db.cache_it_43b_clearances.where("[company_id+fy_end]").equals([companyId, fyEnd]).toArray();
  return new Map(
    rows.map((r) => [
      String(r.ledger_id),
      {
        cleared_on: r.cleared_on ?? null,
        cleared_paise: Number(r.cleared_paise) || 0,
        reference: r.reference ?? null,
      },
    ]),
  );
}

export async function upsertClearanceLocal(
  companyId: string,
  ledgerId: string,
  fyEnd: string,
  c: Clearance,
): Promise<void> {
  await db.cache_it_43b_clearances.put({
    id: clearanceKey(companyId, ledgerId, fyEnd),
    company_id: companyId,
    ledger_id: ledgerId,
    fy_end: fyEnd,
    cleared_on: c.cleared_on || null,
    cleared_paise: c.cleared_paise ?? 0,
    reference: c.reference || null,
    updated_at: new Date().toISOString(),
  });
}

export async function addFixedAssetLocal(
  companyId: string,
  fyStart: string,
  a: { block_code: string; name: string; opening_wdv_paise: number },
): Promise<ItAsset> {
  const row: ItAsset = {
    id: newId(),
    company_id: companyId,
    block_code: a.block_code,
    ledger_id: null,
    name: a.name,
    fy_start: fyStart,
    opening_wdv_paise: a.opening_wdv_paise,
  };
  await db.cache_it_fixed_assets.put({ ...row, is_active: true, created_at: new Date().toISOString() });
  return row;
}

/** Removes an asset and its movements together. */
export async function removeFixedAssetLocal(companyId: string, assetId: string): Promise<void> {
  await db.transaction("rw", [db.cache_it_fixed_assets, db.cache_it_asset_movements], async () => {
    await db.cache_it_asset_movements.where("asset_id").equals(assetId).delete();
    await db.cache_it_fixed_assets.delete(assetId);
  });
}

export async function addMovementLocal(
  companyId: string,
  fyStart: string,
  assetId: string,
  m: { kind: "addition" | "deletion"; movement_date: string; amount_paise: number; notes?: string },
): Promise<ItMovement> {
  const row: ItMovement = {
    id: newId(),
    asset_id: assetId,
    fy_start: fyStart,
    kind: m.kind,
    movement_date: m.movement_date,
    amount_paise: m.amount_paise,
    notes: m.notes ?? null,
  };
  await db.cache_it_asset_movements.put({ ...row, company_id: companyId, created_at: new Date().toISOString() });
  return row;
}

export async function addDisallowanceLocal(
  companyId: string,
  fyEnd: string,
  r: { section: string; description: string; amount_paise: number },
): Promise<ManualDisallowance> {
  const row: ManualDisallowance = { id: newId(), ...r };
  await db.cache_it_disallowances.put({
    ...row,
    company_id: companyId,
    fy_end: fyEnd,
    created_at: new Date().toISOString(),
  });
  return row;
}

export async function removeDisallowanceLocal(id: string): Promise<void> {
  await db.cache_it_disallowances.delete(id);
}

// ---------- Read helpers for the Section 40A(3) and 43B scans ----------

/** Ids of cash ledgers in the company. */
export async function cashLedgerIdsLocal(companyId: string): Promise<string[]> {
  const rows: any[] = await db.cache_ledgers.where("company_id").equals(companyId).toArray();
  return rows.filter((l) => l.type === "cash").map((l) => String(l.id));
}

/** Payment and journal vouchers dated within [fromDate, toDate]. */
export async function paymentJournalVouchersLocal(
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<{ id: string; voucher_number: string; voucher_date: string }[]> {
  const rows: any[] = await db.cache_vouchers.where("company_id").equals(companyId).toArray();
  return rows
    .filter(
      (v) =>
        notDeleted(v) &&
        ["payment", "journal"].includes(String(v.voucher_type)) &&
        String(v.voucher_date) >= fromDate &&
        String(v.voucher_date) <= toDate,
    )
    .map((v) => ({ id: String(v.id), voucher_number: String(v.voucher_number ?? ""), voucher_date: String(v.voucher_date) }));
}

export async function entriesForVouchersLocal(
  voucherIds: string[],
): Promise<{ voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number }[]> {
  if (voucherIds.length === 0) return [];
  const rows: any[] = await db.cache_voucher_entries.where("voucher_id").anyOf(voucherIds).toArray();
  return rows.map((e) => ({
    voucher_id: String(e.voucher_id),
    ledger_id: String(e.ledger_id),
    debit_paise: Number(e.debit_paise) || 0,
    credit_paise: Number(e.credit_paise) || 0,
  }));
}

export async function ledgerNamesLocal(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const rows = await db.cache_ledgers.bulkGet(ids);
  return rows
    .filter((r): r is any => !!r)
    .map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
}
