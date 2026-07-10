// Offline-replayable executors for voucher creation.
//
// The corresponding UI components (ItemVoucherForm, EntryVoucherForm) build a
// fully serializable `snap` payload and either run the executor directly
// (online) or queue it through the outbox (offline). On reconnect, the sync
// worker drains the outbox by looking up the executor here by `key` and
// re-running it against Supabase — same RPC + insert sequence, same RLS path.
//
// Keep these executors free of React state and DOM-only APIs so they can run
// inside the sync worker. Any per-form UI side effects (e.g. opening the
// EwayBill dialog) stay in the form for the online path only.

import { supabase } from "@/integrations/supabase/client";
import { buildItemVoucherPostings } from "@/lib/voucher-postings";

export type VoucherExecutor = (snap: unknown) => Promise<void>;

const registry: Record<string, VoucherExecutor> = {};

type MasterTable = "ledgers" | "items";
type OfflineMasterRow = Record<string, unknown> & {
  id: string;
  company_id: string;
  name?: string;
  is_deleted?: boolean;
};

const LEDGER_COLUMNS = [
  "id",
  "company_id",
  "name",
  "type",
  "group_code",
  "subgroup_id",
  "gstin",
  "pan",
  "state",
  "state_code",
  "address",
  "phone",
  "email",
  "opening_balance_paise",
  "opening_balance_is_debit",
  "credit_limit_paise",
  "credit_days",
  "whatsapp_number",
  "reminders_enabled",
  "gst_treatment",
  "country",
  "is_active",
  "updated_at",
] as const;

const ITEM_COLUMNS = [
  "id",
  "company_id",
  "name",
  "hsn_code",
  "unit",
  "gst_rate",
  "opening_stock_qty",
  "opening_stock_rate_paise",
  "reorder_level",
  "is_active",
  "purchase_price_paise",
  "sale_price_paise",
  "updated_at",
] as const;

async function getOfflineDb() {
  const module = await import("./db");
  return module.default || module.offlineDb || module.db || (module as any);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function nextLocalVoucherNumber(companyId: string, voucherType: string): Promise<string> {
  const db = await getOfflineDb();
  const rows = await db.cache_vouchers
    .where("company_id")
    .equals(companyId)
    .filter((v: any) => v?.is_deleted !== true && v?.voucher_type === voucherType)
    .toArray();
  let max = 0;
  for (const row of rows as Array<{ voucher_number?: unknown }>) {
    const n = parseInt(String(row.voucher_number ?? "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

async function runLocalItemVoucherCreate(snap: ItemVoucherSnap): Promise<{ voucherId: string; voucherNumber: string }> {
  const db = await getOfflineDb();
  const voucherId = crypto.randomUUID();
  const voucherNumber = await nextLocalVoucherNumber(snap.companyId, snap.voucherType);
  const stamp = nowIso();
  const lines = snap.lines.map(({ l, c }) => ({ l, c }));

  const itemRows = lines.map(({ l, c }, i) => ({
    id: crypto.randomUUID(),
    voucher_id: voucherId,
    company_id: snap.companyId,
    item_id: l.item_id,
    line_no: i + 1,
    description: l.description || null,
    qty: parseFloat(l.qty) || 0,
    rate_paise: Math.round((parseFloat(l.rate) || 0) * 100),
    discount_paise: c.discount_paise,
    amount_paise: c.amount_paise,
    taxable_paise: c.taxable_paise,
    gst_rate: c.gst_rate,
    cgst_paise: c.cgst_paise,
    sgst_paise: c.sgst_paise,
    igst_paise: c.igst_paise,
    cost_centre_id: (l as any).cost_centre_id ?? null,
    cost_category_id: (l as any).cost_category_id ?? null,
    updated_at: stamp,
  }));

  const skipPostings =
    snap.voucherType === "sales_order" ||
    snap.voucherType === "delivery_note" ||
    snap.voucherType === "quotation";

  let entryRows: Array<{
    id: string;
    voucher_id: string;
    company_id: string;
    ledger_id: string;
    debit_paise: number;
    credit_paise: number;
    line_no: number;
    narration: string | null;
    updated_at: string;
  }> = [];

  if (!skipPostings) {
    let capitalItems: Array<{
      name: string;
      taxable_paise: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
    }> | undefined;

    if (snap.itcClass === "capital_goods") {
      const ids = uniqueIds(lines.map((x) => x.l.item_id));
      const cached = await Promise.all(ids.map((id) => db.cache_items.get(id)));
      const byId = new Map(cached.filter(Boolean).map((row: any) => [row.id, row.name as string]));
      capitalItems = lines.map(({ l, c }) => ({
        name: (byId.get(l.item_id) || l.description || "Capital Asset").trim(),
        taxable_paise: c.taxable_paise,
        cgst_paise: c.cgst_paise,
        sgst_paise: c.sgst_paise,
        igst_paise: c.igst_paise,
      }));
    }

    const postings = await buildItemVoucherPostings(
      snap.companyId,
      snap.voucherType as "sales" | "purchase" | "credit_note" | "debit_note",
      snap.partyId,
      snap.totals,
      {
        itcClass: snap.itcClass,
        itcEligible: snap.itcEligible,
        capitalItems,
        sundries: (snap.sundries ?? []).map((s) => ({
          ledger_id: s.ledger_id,
          amount_paise: s.amount_paise,
        })),
      },
    );
    const { assertVoucherBalanced } = await import("@/lib/voucher-invariants");
    assertVoucherBalanced(postings, { voucherType: snap.voucherType, companyId: snap.companyId });
    entryRows = postings.map((p) => ({
      id: crypto.randomUUID(),
      voucher_id: voucherId,
      company_id: snap.companyId,
      ledger_id: p.ledger_id,
      debit_paise: p.debit_paise,
      credit_paise: p.credit_paise,
      narration: p.narration ?? null,
      line_no: p.line_no,
      updated_at: stamp,
    }));
  }

  const sundryRows = (snap.sundries ?? [])
    .filter((s) => s && s.ledger_id && s.amount_paise !== 0)
    .map((s, i) => ({
      id: s.id ?? crypto.randomUUID(),
      voucher_id: voucherId,
      company_id: snap.companyId,
      sundry_type: s.sundry_type,
      ledger_id: s.ledger_id,
      amount_paise: s.amount_paise,
      line_no: i + 1,
      narration: s.narration ?? null,
      updated_at: stamp,
    }));

  await db.transaction(
    "rw",
    db.cache_vouchers,
    db.cache_voucher_items,
    db.cache_voucher_entries,
    db.cache_bill_sundries,
    async () => {
      await db.cache_vouchers.put({
        id: voucherId,
        company_id: snap.companyId,
        voucher_type: snap.voucherType,
        voucher_number: voucherNumber,
        voucher_date: snap.voucherDate,
        party_ledger_id: snap.partyId,
        reference_no: snap.refNo || null,
        narration: snap.narration || null,
        is_interstate: snap.interstate,
        subtotal_paise: snap.totals.subtotal_paise,
        cgst_paise: snap.totals.cgst_paise,
        sgst_paise: snap.totals.sgst_paise,
        igst_paise: snap.totals.igst_paise,
        round_off_paise: snap.totals.round_off_paise ?? 0,
        total_paise: snap.totals.total_paise,
        place_of_supply_code: snap.placeOfSupply || null,
        itc_class: snap.itcClass,
        itc_eligible: snap.itcEligible,
        supply_nature: snap.supplyNature ?? "taxable",
        original_voucher_id: snap.originalVoucherId,
        is_deleted: false,
        is_synced: true,
        created_at: stamp,
        updated_at: stamp,
      });
      if (itemRows.length > 0) await db.cache_voucher_items.bulkPut(itemRows);
      if (entryRows.length > 0) await db.cache_voucher_entries.bulkPut(entryRows);
      if (sundryRows.length > 0) await db.cache_bill_sundries.bulkPut(sundryRows);
    },
  );

  return { voucherId, voucherNumber };
}


async function runLocalEntryVoucherCreate(snap: EntryVoucherSnap): Promise<void> {
  const db = await getOfflineDb();
  const voucherId = crypto.randomUUID();
  const voucherNumber = await nextLocalVoucherNumber(snap.companyId, snap.voucherType);
  const stamp = nowIso();
  const entries = snap.entries.map((e) => ({
    id: crypto.randomUUID(),
    voucher_id: voucherId,
    company_id: snap.companyId,
    ledger_id: e.ledger_id,
    debit_paise: e.debit_paise,
    credit_paise: e.credit_paise,
    narration: e.narration,
    line_no: e.line_no,
    updated_at: stamp,
  }));
  const { assertVoucherBalanced } = await import("@/lib/voucher-invariants");
  assertVoucherBalanced(entries, { voucherType: snap.voucherType, companyId: snap.companyId });

  await db.transaction("rw", db.cache_vouchers, db.cache_voucher_entries, async () => {
    await db.cache_vouchers.put({
      id: voucherId,
      company_id: snap.companyId,
      voucher_type: snap.voucherType,
      voucher_number: voucherNumber,
      voucher_date: snap.voucherDate,
      party_ledger_id: snap.partyLedgerId,
      reference_no: snap.refNo || null,
      narration: snap.narration || null,
      is_interstate: false,
      subtotal_paise: snap.total,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      round_off_paise: 0,
      total_paise: snap.total,
      is_deleted: false,
      is_synced: true,
      created_at: stamp,
      updated_at: stamp,
    });
    await db.cache_voucher_entries.bulkPut(entries);
  });
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

async function fetchExistingMasterIds(table: MasterTable, companyId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await (supabase as any)
    .from(table)
    .select("id")
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) throw error;
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

function sanitizeMasterRow(table: MasterTable, row: OfflineMasterRow): Record<string, unknown> {
  const columns = table === "ledgers" ? LEDGER_COLUMNS : ITEM_COLUMNS;
  const clean: Record<string, unknown> = {};
  for (const col of columns) {
    if (row[col] !== undefined) clean[col] = row[col];
  }

  clean.id = row.id;
  clean.company_id = row.company_id;
  clean.name = String(row.name ?? "").trim();
  clean.updated_at = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString();
  clean.is_active = row.is_active !== false;

  if (table === "ledgers") {
    clean.type = clean.type ?? "sundry_debtor";
    clean.gst_treatment = clean.gst_treatment ?? "regular";
    clean.opening_balance_paise = clean.opening_balance_paise ?? 0;
    clean.opening_balance_is_debit = clean.opening_balance_is_debit ?? true;
    clean.credit_limit_paise = clean.credit_limit_paise ?? 0;
    clean.credit_days = clean.credit_days ?? 0;
  } else {
    clean.unit = clean.unit ?? "NOS";
    clean.gst_rate = clean.gst_rate ?? 0;
    clean.opening_stock_qty = clean.opening_stock_qty ?? 0;
    clean.opening_stock_rate_paise = clean.opening_stock_rate_paise ?? 0;
    clean.reorder_level = clean.reorder_level ?? 0;
    clean.purchase_price_paise = clean.purchase_price_paise ?? 0;
    clean.sale_price_paise = clean.sale_price_paise ?? 0;
  }

  return clean;
}

async function ensureMasterRefsSynced(
  table: MasterTable,
  companyId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = uniqueIds(ids);
  const remap = new Map<string, string>();
  if (wanted.length === 0) return remap;

  // Bug 2.1 guard — in local-only mode there is no cloud master list to
  // reconcile against. Skip the Supabase SELECT/UPSERT entirely; the local
  // IndexedDB is authoritative and voucher entries reference cache_ledgers
  // / cache_items by id directly.
  const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
  if (isLocalOnlyMode()) return remap;

  const existing = await fetchExistingMasterIds(table, companyId, wanted);
  const missing = wanted.filter((id) => !existing.has(id));
  if (missing.length === 0) return remap;

  const db = await getOfflineDb();
  const cache = table === "ledgers" ? db.cache_ledgers : db.cache_items;
  const cached = (await Promise.all(missing.map((id) => cache.get(id)))) as Array<OfflineMasterRow | undefined>;
  const cachedById = new Map(cached.filter(Boolean).map((r) => [r!.id, r!]));
  const unavailable = missing.filter((id) => {
    const row = cachedById.get(id);
    return !row || row.company_id !== companyId || row.is_deleted === true || !String(row.name ?? "").trim();
  });
  if (unavailable.length > 0) {
    throw new Error(
      `One or more ${table} used in this voucher are missing from both cloud and offline cache (${unavailable.length} missing). ` +
        `Refresh ${table === "ledgers" ? "Ledgers" : "Items"}, re-pick the entry, and save again.`,
    );
  }

  const usable = missing.map((id) => cachedById.get(id)!).filter(Boolean);
  const names = uniqueIds(usable.map((row) => String(row.name ?? "").trim()));
  if (names.length > 0) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select("id, name")
      .eq("company_id", companyId)
      .in("name", names);
    if (error) throw error;
    const byName = new Map(((data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name, row.id]));
    for (const row of usable) {
      const existingId = byName.get(String(row.name ?? "").trim());
      if (existingId) remap.set(row.id, existingId);
    }
  }

  const toUpsert = usable
    .filter((row) => !remap.has(row.id))
    .map((row) => sanitizeMasterRow(table, row));

  if (toUpsert.length > 0) {
    const { data: upserted, error } = await (supabase as any)
      .from(table)
      .upsert(toUpsert, { onConflict: "id" })
      .select("id");
    if (error) {
      throw new Error(`Could not sync ${table} required by this voucher: ${error.message}`);
    }
    const landedIds = new Set(((upserted ?? []) as Array<{ id: string }>).map((r) => r.id));
    // If Postgres accepted the upsert but returned no rows, RLS silently
    // filtered the return — usually a stale session. Surface a clear message.
    if (landedIds.size === 0) {
      throw new Error(
        `Could not save ${table === "ledgers" ? "ledger" : "item"} references to the cloud. ` +
          `Please refresh the page (or sign out and back in) and try again.`,
      );
    }
    // Trust the upsert response — do NOT re-SELECT immediately, PostgREST
    // read-after-write can lag and cause a false "still missing" error.
    for (const row of toUpsert) {
      if (landedIds.has(row.id as string)) {
        // no remap needed — same id, now present on server
      }
    }
  }

  return remap;
}


function remapId(id: string, remap: Map<string, string>): string {
  return remap.get(id) ?? id;
}

export function registerVoucherExecutor(key: string, fn: VoucherExecutor): void {
  registry[key] = fn;
}

export function getVoucherExecutor(key: string): VoucherExecutor | undefined {
  return registry[key];
}

// ---------- Shared types -----------------------------------------------------

export interface ItemVoucherSnap {
  companyId: string;
  voucherType:
    | "sales"
    | "purchase"
    | "credit_note"
    | "debit_note"
    | "sales_order"
    | "delivery_note"
    | "quotation";
  voucherDate: string;
  partyId: string;
  refNo: string;
  narration: string;
  placeOfSupply: string;
  interstate: boolean;
  itcClass: "inputs" | "capital_goods" | "input_services" | "ineligible" | "na";
  itcEligible: boolean;
  supplyNature?: "taxable" | "zero_rated_wp" | "zero_rated_wop" | "nil_rated" | "exempt" | "non_gst";
  originalVoucherId: string | null;
  totals: {
    subtotal_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    round_off_paise: number;
    total_paise: number;
  };
  lines: Array<{
    l: {
      item_id: string;
      description: string;
      qty: string;
      rate: string;
    };
    c: {
      discount_paise: number;
      amount_paise: number;
      taxable_paise: number;
      gst_rate: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
      total_paise: number;
    };
  }>;
  /**
   * Bill sundries (freight, packing, discount, ...). Optional; when omitted
   * the voucher behaves exactly as before. `amount_paise` is signed. Caller
   * is responsible for having folded the net into `totals.total_paise`
   * before invoking the executor.
   */
  sundries?: Array<{
    id: string;
    sundry_type: string;
    ledger_id: string;
    amount_paise: number;
    narration?: string | null;
  }>;
}


export interface EntryVoucherSnap {
  companyId: string;
  voucherType: "receipt" | "payment" | "journal";
  voucherDate: string;
  partyLedgerId: string | null;
  refNo: string;
  narration: string;
  total: number;
  entries: Array<{
    ledger_id: string;
    debit_paise: number;
    credit_paise: number;
    narration: string | null;
    line_no: number;
  }>;
}

// ---------- Item voucher executor -------------------------------------------

export async function runItemVoucherCreate(snap: ItemVoucherSnap): Promise<{ voucherId: string; voucherNumber: string }> {
  const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
  if (isLocalOnlyMode()) return runLocalItemVoucherCreate(snap);

  const ledgerRemap = await ensureMasterRefsSynced("ledgers", snap.companyId, [snap.partyId]);
  const itemRemap = await ensureMasterRefsSynced("items", snap.companyId, snap.lines.map((x) => x.l.item_id));
  const partyId = remapId(snap.partyId, ledgerRemap);
  const lines = snap.lines.map(({ l, c }) => ({
    l: { ...l, item_id: remapId(l.item_id, itemRemap) },
    c,
  }));

  const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
    _company_id: snap.companyId,
    _type: snap.voucherType,
  });
  if (numErr) throw numErr;
  const voucherNumber = numData as string;

  const itemRows = lines.map(({ l, c }, i) => ({
    item_id: l.item_id,
    line_no: i + 1,
    description: l.description || null,
    qty: parseFloat(l.qty) || 0,
    rate_paise: Math.round((parseFloat(l.rate) || 0) * 100),
    discount_paise: c.discount_paise,
    amount_paise: c.amount_paise,
    taxable_paise: c.taxable_paise,
    gst_rate: c.gst_rate,
    cgst_paise: c.cgst_paise,
    sgst_paise: c.sgst_paise,
    igst_paise: c.igst_paise,
  }));

  const skipPostings =
    snap.voucherType === "sales_order" ||
    snap.voucherType === "delivery_note" ||
    snap.voucherType === "quotation";

  let entryRows: Array<{
    ledger_id: string;
    debit_paise: number;
    credit_paise: number;
    line_no: number;
  }> = [];
  if (!skipPostings) {
    let capitalItems: Array<{
      name: string;
      taxable_paise: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
    }> | undefined;
    if (snap.itcClass === "capital_goods") {
      const ids = lines.map((x) => x.l.item_id).filter(Boolean);
      const { data: itemRecs } = await supabase
        .from("items")
        .select("id, name")
        .in("id", ids);
      const byId = new Map((itemRecs ?? []).map((r) => [r.id, r.name as string]));
      capitalItems = lines.map(({ l, c }) => ({
        name: (byId.get(l.item_id) || l.description || "Capital Asset").trim(),
        taxable_paise: c.taxable_paise,
        cgst_paise: c.cgst_paise,
        sgst_paise: c.sgst_paise,
        igst_paise: c.igst_paise,
      }));
    }
    const postings = await buildItemVoucherPostings(
      snap.companyId,
      snap.voucherType as "sales" | "purchase" | "credit_note" | "debit_note",
      partyId,
      snap.totals,
      {
        itcClass: snap.itcClass,
        itcEligible: snap.itcEligible,
        capitalItems,
        sundries: (snap.sundries ?? []).map((s) => ({
          ledger_id: s.ledger_id,
          amount_paise: s.amount_paise,
        })),
      },
    );
    entryRows = postings.map((p) => ({
      ledger_id: p.ledger_id,
      debit_paise: p.debit_paise,
      credit_paise: p.credit_paise,
      line_no: p.line_no,
    }));
  }

  // Post-build, pre-write invariant: Dr = Cr in paise. See
  // src/lib/voucher-invariants.ts. Skip for non-posting voucher types
  // (quotation, sales_order, delivery_note) that intentionally carry no
  // ledger entries.
  if (!skipPostings) {
    const { assertVoucherBalanced } = await import("@/lib/voucher-invariants");
    assertVoucherBalanced(entryRows, { voucherType: snap.voucherType, companyId: snap.companyId });
  }

  const header = {
    company_id: snap.companyId,
    voucher_type: snap.voucherType,
    voucher_number: voucherNumber,
    voucher_date: snap.voucherDate,
    party_ledger_id: partyId,
    reference_no: snap.refNo || null,
    narration: snap.narration || null,
    is_interstate: snap.interstate,
    subtotal_paise: snap.totals.subtotal_paise,
    cgst_paise: snap.totals.cgst_paise,
    sgst_paise: snap.totals.sgst_paise,
    igst_paise: snap.totals.igst_paise,
    round_off_paise: snap.totals.round_off_paise,
    total_paise: snap.totals.total_paise,
    place_of_supply_code: snap.placeOfSupply || null,
    itc_class: snap.itcClass,
    itc_eligible: snap.itcEligible,
    supply_nature: snap.supplyNature ?? "taxable",
    original_voucher_id: snap.originalVoucherId,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vid, error: saveErr } = await supabase.rpc("save_voucher_atomic", {
    _header: header as any,
    _items: itemRows as any,
    _entries: entryRows as any,
  });
  if (saveErr) throw saveErr;
  return { voucherId: vid as string, voucherNumber };
}

// ---------- Entry voucher executor ------------------------------------------

export async function runEntryVoucherCreate(snap: EntryVoucherSnap): Promise<void> {
  const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
  if (isLocalOnlyMode()) return runLocalEntryVoucherCreate(snap);

  const ledgerIds = Array.from(
    new Set(
      [
        snap.partyLedgerId ?? "",
        ...snap.entries.map((e) => e.ledger_id),
      ].filter(Boolean),
    ),
  );
  const ledgerRemap = await ensureMasterRefsSynced("ledgers", snap.companyId, ledgerIds);
  const partyLedgerId = snap.partyLedgerId ? remapId(snap.partyLedgerId, ledgerRemap) : null;
  const snapEntries = snap.entries.map((e) => ({ ...e, ledger_id: remapId(e.ledger_id, ledgerRemap) }));

  const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
    _company_id: snap.companyId,
    _type: snap.voucherType,
  });
  if (numErr) throw numErr;
  const header = {
    company_id: snap.companyId,
    voucher_type: snap.voucherType,
    voucher_number: numData as string,
    voucher_date: snap.voucherDate,
    party_ledger_id: partyLedgerId,
    reference_no: snap.refNo || null,
    narration: snap.narration || null,
    is_interstate: false,
    subtotal_paise: snap.total,
    total_paise: snap.total,
  };
  const entries = snapEntries.map((e) => ({
    ledger_id: e.ledger_id,
    debit_paise: e.debit_paise,
    credit_paise: e.credit_paise,
    narration: e.narration,
    line_no: e.line_no,
  }));
  // Post-build, pre-write invariant: Dr = Cr in paise.
  const { assertVoucherBalanced } = await import("@/lib/voucher-invariants");
  assertVoucherBalanced(entries, { voucherType: snap.voucherType, companyId: snap.companyId });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: saveErr } = await supabase.rpc("save_voucher_atomic", {
    _header: header as any,
    _entries: entries as any,
    _items: [] as any,
  });
  if (saveErr) throw saveErr;
}

// ---------- Registration -----------------------------------------------------

export const ITEM_VOUCHER_KEY = "item_voucher_create";
export const ENTRY_VOUCHER_KEY = "entry_voucher_create";

registerVoucherExecutor(ITEM_VOUCHER_KEY, (snap) => runItemVoucherCreate(snap as ItemVoucherSnap).then(() => undefined));
registerVoucherExecutor(ENTRY_VOUCHER_KEY, (snap) => runEntryVoucherCreate(snap as EntryVoucherSnap));
