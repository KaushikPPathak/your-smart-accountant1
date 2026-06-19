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
  const { data: numData, error: numErr } = await supabase.rpc("next_voucher_number", {
    _company_id: snap.companyId,
    _type: snap.voucherType,
  });
  if (numErr) throw numErr;
  const voucherNumber = numData as string;

  const itemRows = snap.lines.map(({ l, c }, i) => ({
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
      const ids = snap.lines.map((x) => x.l.item_id).filter(Boolean);
      const { data: itemRecs } = await supabase
        .from("items")
        .select("id, name")
        .in("id", ids);
      const byId = new Map((itemRecs ?? []).map((r) => [r.id, r.name as string]));
      capitalItems = snap.lines.map(({ l, c }) => ({
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
      },
    );
    entryRows = postings.map((p) => ({
      ledger_id: p.ledger_id,
      debit_paise: p.debit_paise,
      credit_paise: p.credit_paise,
      line_no: p.line_no,
    }));
  }

  const header = {
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
    round_off_paise: snap.totals.round_off_paise,
    total_paise: snap.totals.total_paise,
    place_of_supply_code: snap.placeOfSupply || null,
    itc_class: snap.itcClass,
    itc_eligible: snap.itcEligible,
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
    party_ledger_id: snap.partyLedgerId,
    reference_no: snap.refNo || null,
    narration: snap.narration || null,
    is_interstate: false,
    subtotal_paise: snap.total,
    total_paise: snap.total,
  };
  const entries = snap.entries.map((e) => ({
    ledger_id: e.ledger_id,
    debit_paise: e.debit_paise,
    credit_paise: e.credit_paise,
    narration: e.narration,
    line_no: e.line_no,
  }));
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
