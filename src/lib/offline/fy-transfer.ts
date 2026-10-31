// Financial-year transfer for the local-only build.
//
// Split mode carries the closing balances of one year (as at the year end)
// into a company for the next year. It is designed to be run again and again:
// the first run creates the next-year company; later runs refresh only the
// rows this transfer carried, so accounting can continue in both years.
//
// Carried rows are tagged with carry_source_id (the source ledger or item id,
// or CARRY_PL_SOURCE for the net-profit row). Rows the user adds in the new year
// have no tag and are never touched by a refresh.
//
// Everything reads and writes the local database only.

import { offlineDb as db } from "@/lib/offline/db";
import { newId } from "@/lib/utils/sys-utils";
import { emitDataChange } from "@/lib/ai/cache-events";

export const PL_TYPES = new Set(["expense_direct", "expense_indirect", "income_direct", "income_indirect"]);
const CARRY_PL_SOURCE = "__PL__";
const CASH_TYPES = new Set(["cash", "bank"]);
const BATCH = 400;

type Row = Record<string, any>;

const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const signedOf = (paise: unknown, isDebit: unknown) => (isDebit ? 1 : -1) * Number(paise || 0);

/** Fetch rows by voucher id in chunks, so large books never load all entries at once. */
async function rowsForVouchers(table: "cache_voucher_entries" | "cache_voucher_items", voucherIds: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < voucherIds.length; i += BATCH) {
    const part = voucherIds.slice(i, i + BATCH);
    const rows = await (db as any)[table].where("voucher_id").anyOf(part).toArray();
    out.push(...rows);
  }
  return out;
}

/** Vouchers of a company up to and including fyEnd, with their id map. */
async function vouchersUpTo(companyId: string, fyEnd: string): Promise<Map<string, Row>> {
  const all: Row[] = await db.cache_vouchers.where("company_id").equals(companyId).toArray();
  return new Map(
    all.filter((v) => !v.is_deleted && !v.deleted_at && String(v.voucher_date) <= fyEnd).map((v) => [v.id, v]),
  );
}

interface CarryData {
  carriedLedgers: { src: Row; signed: number }[];
  carriedItems: { src: Row; qty: number; rate: number }[];
  netProfitPaise: number;
  cashNegatives: { name: string; paise: number }[];
  negativeStock: { name: string; qty: number }[];
}

/** Closing balances at fyEnd, from the local books. */
export async function computeCarryData(companyId: string, fyEnd: string): Promise<CarryData> {
  const ledgers: Row[] = (await db.cache_ledgers.where("company_id").equals(companyId).toArray())
    .filter((l) => !l.is_deleted);
  const items: Row[] = (await db.cache_items.where("company_id").equals(companyId).toArray())
    .filter((i) => !i.is_deleted);
  const vById = await vouchersUpTo(companyId, fyEnd);
  const ids = [...vById.keys()];
  const entries = await rowsForVouchers("cache_voucher_entries", ids);
  const vitems = await rowsForVouchers("cache_voucher_items", ids);

  const movement = new Map<string, number>();
  for (const e of entries) {
    movement.set(e.ledger_id, (movement.get(e.ledger_id) ?? 0) + Number(e.debit_paise || 0) - Number(e.credit_paise || 0));
  }

  let netProfitPaise = 0;
  const carriedLedgers: { src: Row; signed: number }[] = [];
  const cashNegatives: { name: string; paise: number }[] = [];
  for (const l of ledgers) {
    const closing = signedOf(l.opening_balance_paise, l.opening_balance_is_debit) + (movement.get(l.id) ?? 0);
    if (PL_TYPES.has(l.type)) {
      netProfitPaise += -closing;
    } else {
      carriedLedgers.push({ src: l, signed: closing });
    }
    if (CASH_TYPES.has(l.type) && closing < 0) cashNegatives.push({ name: l.name, paise: closing });
  }

  const isIn = (t: string) => t === "purchase" || t === "credit_note";
  const isOut = (t: string) => t === "sales" || t === "debit_note";
  const isMfg = (t: string) => t === "manufacturing";
  const movesByItem = new Map<string, Row[]>();
  for (const vi of vitems) {
    const v = vById.get(vi.voucher_id);
    if (!v || !vi.item_id) continue;
    const list = movesByItem.get(vi.item_id) ?? [];
    list.push({ qty: Number(vi.qty) || 0, rate_paise: Number(vi.rate_paise) || 0, type: v.voucher_type });
    movesByItem.set(vi.item_id, list);
  }

  const carriedItems: { src: Row; qty: number; rate: number }[] = [];
  const negativeStock: { name: string; qty: number }[] = [];
  for (const it of items) {
    let q = Number(it.opening_stock_qty) || 0;
    let lastInRate = Number(it.opening_stock_rate_paise) || 0;
    for (const m of movesByItem.get(it.id) ?? []) {
      const v = m.qty;
      if (isMfg(m.type)) { q += v; if (v > 0 && m.rate_paise) lastInRate = m.rate_paise; }
      else if (isIn(m.type)) { q += Math.abs(v); if (m.rate_paise) lastInRate = m.rate_paise; }
      else if (isOut(m.type)) { q -= Math.abs(v); }
    }
    carriedItems.push({ src: it, qty: q, rate: lastInRate || Number(it.purchase_price_paise) || 0 });
    if (q < 0) negativeStock.push({ name: it.name, qty: q });
  }

  return { carriedLedgers, carriedItems, netProfitPaise, cashNegatives, negativeStock };
}

export interface TransferPreview {
  /** Id of the next-year company when it already exists. */
  targetId: string | null;
  sourceName: string;
  nextName: string;
  nextFyStart: string;
  netProfitPaise: number;
  ledgers: { add: string[]; change: string[]; remove: string[]; keptInUse: string[]; clashes: string[]; handEdited: string[] };
  items: { add: string[]; change: string[]; remove: string[]; keptInUse: string[]; clashes: string[]; handEdited: string[] };
  cashNegatives: { name: string; paise: number }[];
  negativeStock: { name: string; qty: number }[];
  // Internal: the rows to write, so apply uses exactly what was previewed.
  _plan: {
    ledgerAdds: Row[];
    ledgerChanges: { id: string; patch: Row }[];
    ledgerRemoves: string[];
    itemAdds: Row[];
    itemChanges: { id: string; patch: Row }[];
    itemRemoves: string[];
    sourceRow: Row;
  };
}

async function findNextCompany(sourceId: string, nextFyStart: string): Promise<Row | null> {
  const all: Row[] = await db.cache_companies.toArray();
  return all.find((c) => c.carried_from_company_id === sourceId && String(c.financial_year_start) === nextFyStart) ?? null;
}

/** Build the transfer plan. Writes nothing. */
export async function buildTransferPreview(args: {
  sourceId: string;
  fyEnd: string;
  nextFyStart: string;
  nextName: string;
}): Promise<TransferPreview> {
  const { sourceId, fyEnd, nextFyStart, nextName } = args;
  const sourceRow: Row | undefined = await db.cache_companies.get(sourceId);
  if (!sourceRow) throw new Error("The company to carry forward is not on this PC.");

  const data = await computeCarryData(sourceId, fyEnd);
  const target = await findNextCompany(sourceId, nextFyStart);
  const tid: string | null = target?.id ?? null;

  // Desired carried ledgers, keyed by source id.
  const desired = new Map<string, Row>();
  for (const { src: l, signed } of data.carriedLedgers) {
    desired.set(l.id, {
      carry_source_id: l.id,
      name: l.name,
      type: l.type,
      group_code: l.group_code,
      state: l.state ?? null,
      state_code: l.state_code ?? null,
      gstin: l.gstin ?? null,
      gst_treatment: l.gst_treatment ?? "regular",
      opening_balance_paise: Math.abs(signed),
      opening_balance_is_debit: signed >= 0,
      carry_signed_opening: signed,
    });
  }
  if (data.netProfitPaise !== 0) {
    const np = data.netProfitPaise;
    desired.set(CARRY_PL_SOURCE, {
      carry_source_id: CARRY_PL_SOURCE,
      name: "Profit & Loss A/c",
      type: "capital",
      group_code: "RESERVES_AND_SURPLUS",
      state: null,
      state_code: null,
      gstin: null,
      gst_treatment: "regular",
      opening_balance_paise: Math.abs(np),
      opening_balance_is_debit: np < 0,
      carry_signed_opening: np < 0 ? -Math.abs(np) : Math.abs(np),
    });
  }

  // Current state of the next-year company (if it exists).
  const existingLedgers: Row[] = tid
    ? await db.cache_ledgers.where("company_id").equals(tid).toArray()
    : [];
  const existingItems: Row[] = tid
    ? await db.cache_items.where("company_id").equals(tid).toArray()
    : [];
  const carriedExisting = new Map(existingLedgers.filter((l) => l.carry_source_id).map((l) => [l.carry_source_id, l]));
  const manualLedgerNames = new Set(existingLedgers.filter((l) => !l.carry_source_id && !l.is_deleted).map((l) => lc(l.name)));

  // Rows already used by next-year vouchers cannot be removed.
  const usedLedgerIds = new Set<string>();
  const usedItemIds = new Set<string>();
  if (tid) {
    const nextVouchers: Row[] = await db.cache_vouchers.where("company_id").equals(tid).toArray();
    const vids = nextVouchers.map((v) => v.id);
    for (const e of await rowsForVouchers("cache_voucher_entries", vids)) usedLedgerIds.add(e.ledger_id);
    for (const vi of await rowsForVouchers("cache_voucher_items", vids)) if (vi.item_id) usedItemIds.add(vi.item_id);
  }

  const L = { add: [] as string[], change: [] as string[], remove: [] as string[], keptInUse: [] as string[], clashes: [] as string[], handEdited: [] as string[] };
  const ledgerAdds: Row[] = [];
  const ledgerChanges: { id: string; patch: Row }[] = [];
  const ledgerRemoves: string[] = [];

  for (const [srcId, row] of desired) {
    const have = carriedExisting.get(srcId);
    if (!have) {
      if (manualLedgerNames.has(lc(row.name))) { L.clashes.push(row.name); continue; }
      ledgerAdds.push({ id: newId(), company_id: tid ?? "", ...row, updated_at: new Date().toISOString() });
      L.add.push(row.name);
      continue;
    }
    const haveSigned = signedOf(have.opening_balance_paise, have.opening_balance_is_debit);
    if (have.carry_signed_opening !== undefined && haveSigned !== Number(have.carry_signed_opening)) {
      L.handEdited.push(row.name);
    }
    const changed =
      haveSigned !== row.carry_signed_opening || have.type !== row.type || have.group_code !== row.group_code || have.name !== row.name;
    if (changed) {
      ledgerChanges.push({
        id: have.id,
        patch: {
          name: row.name, type: row.type, group_code: row.group_code,
          opening_balance_paise: row.opening_balance_paise,
          opening_balance_is_debit: row.opening_balance_is_debit,
          carry_signed_opening: row.carry_signed_opening,
          updated_at: new Date().toISOString(),
        },
      });
      L.change.push(row.name);
    }
  }
  for (const have of carriedExisting.values()) {
    if (desired.has(have.carry_source_id)) continue;
    if (usedLedgerIds.has(have.id)) { L.keptInUse.push(have.name); continue; }
    ledgerRemoves.push(have.id);
    L.remove.push(have.name);
  }

  // ---- Items ----
  const I = { add: [] as string[], change: [] as string[], remove: [] as string[], keptInUse: [] as string[], clashes: [] as string[], handEdited: [] as string[] };
  const itemAdds: Row[] = [];
  const itemChanges: { id: string; patch: Row }[] = [];
  const itemRemoves: string[] = [];
  const carriedItemsExisting = new Map(existingItems.filter((i) => i.carry_source_id).map((i) => [i.carry_source_id, i]));
  const manualItemNames = new Set(existingItems.filter((i) => !i.carry_source_id && !i.is_deleted).map((i) => lc(i.name)));
  const desiredItems = new Map(data.carriedItems.map((c) => [c.src.id, c]));

  for (const [srcId, c] of desiredItems) {
    const row = {
      carry_source_id: srcId,
      name: c.src.name,
      unit: c.src.unit,
      hsn_code: c.src.hsn_code ?? null,
      gst_rate: c.src.gst_rate ?? 0,
      opening_stock_qty: c.qty,
      opening_stock_rate_paise: c.rate,
      purchase_price_paise: c.src.purchase_price_paise ?? 0,
      sale_price_paise: c.src.sale_price_paise ?? 0,
      reorder_level: c.src.reorder_level ?? 0,
      carry_qty: c.qty,
    };
    const have = carriedItemsExisting.get(srcId);
    if (!have) {
      if (manualItemNames.has(lc(row.name))) { I.clashes.push(row.name); continue; }
      itemAdds.push({ id: newId(), company_id: tid ?? "", ...row, is_active: true, is_deleted: false, updated_at: new Date().toISOString() });
      I.add.push(row.name);
      continue;
    }
    if (have.carry_qty !== undefined && Number(have.opening_stock_qty) !== Number(have.carry_qty)) {
      I.handEdited.push(row.name);
    }
    const changed = Number(have.opening_stock_qty) !== row.opening_stock_qty
      || Number(have.opening_stock_rate_paise) !== row.opening_stock_rate_paise
      || have.name !== row.name || have.unit !== row.unit;
    if (changed) {
      itemChanges.push({ id: have.id, patch: { ...row, updated_at: new Date().toISOString() } });
      I.change.push(row.name);
    }
  }
  for (const have of carriedItemsExisting.values()) {
    if (desiredItems.has(have.carry_source_id)) continue;
    if (usedItemIds.has(have.id)) { I.keptInUse.push(have.name); continue; }
    itemRemoves.push(have.id);
    I.remove.push(have.name);
  }

  return {
    targetId: tid,
    sourceName: sourceRow.name ?? "",
    nextName,
    nextFyStart,
    netProfitPaise: data.netProfitPaise,
    ledgers: L,
    items: I,
    cashNegatives: data.cashNegatives,
    negativeStock: data.negativeStock,
    _plan: { ledgerAdds, ledgerChanges, ledgerRemoves, itemAdds, itemChanges, itemRemoves, sourceRow },
  };
}

/**
 * Apply a previewed plan. The first run creates the next-year company; later
 * runs refresh only carried rows. Returns the next-year company id.
 */
export async function applyTransferPreview(preview: TransferPreview): Promise<string> {
  const p = preview._plan;
  const now = new Date().toISOString();
  let tid = preview.targetId;

  await db.transaction("rw", [db.cache_companies, db.companies, db.cache_ledgers, db.cache_items], async () => {
    if (!tid) {
      tid = newId();
      const s = p.sourceRow;
      const row = {
        id: tid,
        company_id: tid,
        name: preview.nextName,
        entity_status: s.entity_status,
        cin: s.cin,
        share_capital_paise: s.share_capital_paise,
        corpus_fund_paise: s.corpus_fund_paise,
        gstin: s.gstin,
        state: s.state,
        state_code: s.state_code,
        financial_year_start: preview.nextFyStart,
        gst_registered: s.gst_registered,
        gst_filing_frequency: s.gst_filing_frequency,
        inventory_enabled: s.inventory_enabled,
        annual_turnover_paise: s.annual_turnover_paise,
        mode: s.mode,
        currency_code: s.currency_code ?? "INR",
        date_format: s.date_format ?? "dd-mm-yyyy",
        carried_from_company_id: s.id,
        created_by: "local-user",
        updated_at: now,
        is_synced: true,
      };
      await db.cache_companies.put(row);
      await db.companies.put({ id: tid, name: preview.nextName, has_password: false, account_id: "local-user" });
    }

    const withCompany = (r: Row) => ({ ...r, company_id: tid });
    if (p.ledgerAdds.length) await db.cache_ledgers.bulkPut(p.ledgerAdds.map(withCompany));
    for (const c of p.ledgerChanges) await db.cache_ledgers.update(c.id, c.patch);
    if (p.ledgerRemoves.length) await db.cache_ledgers.bulkDelete(p.ledgerRemoves);

    if (p.itemAdds.length) await db.cache_items.bulkPut(p.itemAdds.map(withCompany));
    for (const c of p.itemChanges) await db.cache_items.update(c.id, c.patch);
    if (p.itemRemoves.length) await db.cache_items.bulkDelete(p.itemRemoves);
  });

  emitDataChange(tid!, "ledger");
  emitDataChange(tid!, "item");
  return tid!;
}

/** Extend mode: move the financial-year start of the current company forward. */
export async function extendFinancialYearLocal(companyId: string, nextStart: string): Promise<void> {
  const row: Row | undefined = await db.cache_companies.get(companyId);
  if (!row) throw new Error("The company is not on this PC.");
  await db.cache_companies.update(companyId, { financial_year_start: nextStart, updated_at: new Date().toISOString() });
}
