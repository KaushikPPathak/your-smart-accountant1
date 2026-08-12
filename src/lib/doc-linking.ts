/**
 * Document linking helpers — local-first (IndexedDB), cloud fallback.
 *
 * Two related jobs:
 *
 *  1. Sales-cycle carry-forward: Quotation → Sales Order → Delivery Challan →
 *     Sales Invoice. When a later stage is being raised for a party, the
 *     earlier open documents for that same party are offered, and picking one
 *     pulls its item lines in and stamps the link (original_voucher_id +
 *     reference no).
 *
 *  2. Bill-wise outstanding: open sales / purchase bills for a party with the
 *     already-adjusted amount netted off, used by receipt/payment vouchers.
 *
 * Everything reads the local cache first — business data never leaves the
 * device.
 */
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { supabase } from "@/integrations/supabase/client";
import { offlineDb } from "@/lib/offline/db";
import { readVouchers, readVoucherItems, readBillAllocations } from "@/lib/offline/cache-read";

export interface LinkedDoc {
  id: string;
  voucher_type: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
}

export interface DocLine {
  item_id: string;
  description: string;
  qty: string;
  rate: string;
  discount: string;
  gst_rate: string;
  pending_qty?: number; // Added for partial conversion tracking
}

export interface OpenBill {
  id: string;
  voucher_number: string;
  voucher_date: string;
  due_date: string | null;
  total_paise: number;
  paid_paise: number;
  pending_paise: number;
}

/** Which earlier stages can feed each document type. */
export const SOURCE_STAGES: Record<string, string[]> = {
  sales_order: ["quotation"],
  delivery_note: ["sales_order", "quotation"],
  sales: ["sales_order", "delivery_note", "quotation"],
};

export const STAGE_LABEL: Record<string, string> = {
  quotation: "Quotation",
  sales_order: "Sales Order",
  delivery_note: "Delivery Challan",
  sales: "Sales Invoice",
  purchase: "Purchase Bill",
};

/**
 * Earlier-stage documents for a party that have not already been pulled into
 * a later document. "Consumed" is detected via `original_voucher_id` on any
 * later voucher.
 */
export async function listSourceDocs(
  companyId: string,
  targetType: string,
  partyId: string,
): Promise<LinkedDoc[]> {
  const sources = SOURCE_STAGES[targetType];
  if (!sources || !companyId || !partyId) return [];

  let all: LinkedDoc[] = [];
  let consumed = new Set<string>();

  if (isLocalOnlyMode()) {
    const rows = (await readVouchers(companyId)) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const type = String(r.voucher_type ?? "");
      const orig = r.original_voucher_id ? String(r.original_voucher_id) : "";
      if (orig) consumed.add(orig);
      if (!sources.includes(type)) continue;
      if (String(r.party_ledger_id ?? "") !== partyId) continue;
      all.push({
        id: String(r.id),
        voucher_type: type,
        voucher_number: String(r.voucher_number ?? ""),
        voucher_date: String(r.voucher_date ?? ""),
        total_paise: Number(r.total_paise ?? 0),
      });
    }
  } else {
    const [{ data: srcRows }, { data: laterRows }] = await Promise.all([
      supabase
        .from("vouchers")
        .select("id, voucher_type, voucher_number, voucher_date, total_paise")
        .eq("company_id", companyId)
        .eq("party_ledger_id", partyId)
        .in("voucher_type", sources as never[])
        .order("voucher_date", { ascending: false })
        .limit(200),
      supabase
        .from("vouchers")
        .select("original_voucher_id")
        .eq("company_id", companyId)
        .eq("party_ledger_id", partyId)
        .not("original_voucher_id", "is", null)
        .limit(500),
    ]);
    all = ((srcRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      voucher_type: String(r.voucher_type ?? ""),
      voucher_number: String(r.voucher_number ?? ""),
      voucher_date: String(r.voucher_date ?? ""),
      total_paise: Number(r.total_paise ?? 0),
    }));
    consumed = new Set(
      ((laterRows ?? []) as Array<{ original_voucher_id: string | null }>)
        .map((r) => String(r.original_voucher_id ?? ""))
        .filter(Boolean),
    );
  }

  const rank = (t: string) => sources.indexOf(t);
  return all
    .filter((d) => !consumed.has(d.id))
    .sort((a, b) =>
      rank(a.voucher_type) !== rank(b.voucher_type)
        ? rank(a.voucher_type) - rank(b.voucher_type)
        : a.voucher_date < b.voucher_date
          ? 1
          : -1,
    );
}

/** Item lines of a document, shaped for the item-voucher grid. */
export async function loadDocLines(voucherId: string): Promise<DocLine[]> {
  let rows: Array<Record<string, unknown>> = [];
  if (isLocalOnlyMode()) {
    rows = (await readVoucherItems(voucherId)) as Array<Record<string, unknown>>;
  } else {
    const { data } = await supabase
      .from("voucher_items")
      .select("item_id, description, qty, rate_paise, discount_paise, gst_rate, line_no")
      .eq("voucher_id", voucherId);
    rows = (data ?? []) as Array<Record<string, unknown>>;
  }
  return rows
    .sort((a, b) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0))
    .map((r) => ({
      item_id: String(r.item_id ?? ""),
      description: String(r.description ?? ""),
      qty: String(Number(r.qty ?? 0) || 0),
      rate: (Number(r.rate_paise ?? 0) / 100).toFixed(2),
      discount: (Number(r.discount_paise ?? 0) / 100).toFixed(2),
      gst_rate: String(Number(r.gst_rate ?? 0)),
    }))
    .filter((l) => l.item_id);
}

/**
 * Open bills for a party — sales bills for a customer (receipt), purchase
 * bills for a supplier (payment) — with amounts already adjusted netted off.
 */
export async function listOpenBills(
  companyId: string,
  ledgerId: string,
  partyType: "sundry_debtor" | "sundry_creditor",
): Promise<OpenBill[]> {
  if (!companyId || !ledgerId) return [];
  const invoiceType = partyType === "sundry_debtor" ? "sales" : "purchase";

  let bills: Array<Record<string, unknown>> = [];
  let allocs: Array<{ invoice_voucher_id: string; amount_paise: number }> = [];

  if (isLocalOnlyMode()) {
    const rows = (await readVouchers(companyId, { voucher_type: invoiceType })) as Array<
      Record<string, unknown>
    >;
    bills = rows.filter((r) => String(r.party_ledger_id ?? "") === ledgerId);
    allocs = ((await readBillAllocations(companyId)) as Array<Record<string, unknown>>)
      .filter((a) => String(a.ledger_id ?? "") === ledgerId)
      .map((a) => ({
        invoice_voucher_id: String(a.invoice_voucher_id ?? ""),
        amount_paise: Number(a.amount_paise ?? 0),
      }));
  } else {
    const [v, a] = await Promise.all([
      supabase
        .from("vouchers")
        .select("id, voucher_number, voucher_date, due_date, total_paise")
        .eq("company_id", companyId)
        .eq("party_ledger_id", ledgerId)
        .eq("voucher_type", invoiceType as never)
        .order("voucher_date", { ascending: true }),
      supabase
        .from("bill_allocations")
        .select("invoice_voucher_id, amount_paise")
        .eq("ledger_id", ledgerId),
    ]);
    bills = (v.data ?? []) as Array<Record<string, unknown>>;
    allocs = (a.data ?? []) as Array<{ invoice_voucher_id: string; amount_paise: number }>;
  }

  const paid = new Map<string, number>();
  for (const x of allocs) {
    paid.set(x.invoice_voucher_id, (paid.get(x.invoice_voucher_id) || 0) + x.amount_paise);
  }
  return bills
    .map((b) => {
      const total = Number(b.total_paise ?? 0);
      const p = paid.get(String(b.id)) || 0;
      return {
        id: String(b.id),
        voucher_number: String(b.voucher_number ?? ""),
        voucher_date: String(b.voucher_date ?? ""),
        due_date: (b.due_date as string | null) ?? null,
        total_paise: total,
        paid_paise: p,
        pending_paise: total - p,
      };
    })
    .filter((b) => b.pending_paise > 0)
    .sort((a, b) => (a.voucher_date < b.voucher_date ? -1 : 1));
}

/** Total pending (unadjusted) amount for a party, in paise. */
export async function partyPendingPaise(
  companyId: string,
  ledgerId: string,
  partyType: "sundry_debtor" | "sundry_creditor",
): Promise<number> {
  const bills = await listOpenBills(companyId, ledgerId, partyType);
  return bills.reduce((s, b) => s + b.pending_paise, 0);
}

/** Persist allocations locally (used by the offline executor). */
export async function putLocalAllocations(
  rows: Array<{
    company_id: string;
    invoice_voucher_id: string;
    payment_voucher_id: string;
    ledger_id: string;
    amount_paise: number;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  const stamp = new Date().toISOString();
  await offlineDb.cache_bill_allocations.bulkPut(
    rows.map((r) => ({ id: crypto.randomUUID(), ...r, created_at: stamp, updated_at: stamp })),
  );
}

/**
 * Calculates pending quantities for items in a source voucher by subtracting
 * quantities already consumed in later vouchers that link back to it.
 */
export async function loadDocLinesWithPending(
  voucherId: string,
  companyId: string,
): Promise<DocLine[]> {
  const allLines = await loadDocLines(voucherId);
  if (allLines.length === 0) return [];

  // Find all later vouchers that were carried forward from this one
  let laterVouchers: Array<{ id: string }> = [];
  if (isLocalOnlyMode()) {
    const rows = await offlineDb.cache_vouchers
      .where("original_voucher_id")
      .equals(voucherId)
      .and((v) => v.company_id === companyId && v.is_deleted !== true)
      .toArray();
    laterVouchers = rows.map((r) => ({ id: String(r.id) }));
  } else {
    const { data } = await supabase
      .from("vouchers")
      .select("id")
      .eq("company_id", companyId)
      .eq("original_voucher_id", voucherId);
    laterVouchers = (data ?? []) as Array<{ id: string }>;
  }

  if (laterVouchers.length === 0) {
    return allLines.map((l) => ({ ...l, pending_qty: Number(l.qty) }));
  }

  // Aggregate quantities consumed by item_id
  const consumed = new Map<string, number>();
  for (const v of laterVouchers) {
    let items: Array<{ item_id: string; qty: number }> = [];
    if (isLocalOnlyMode()) {
      const rows = await offlineDb.cache_voucher_items
        .where("voucher_id")
        .equals(v.id)
        .toArray();
      items = rows.map((r) => ({ item_id: String(r.item_id), qty: Number(r.qty ?? 0) }));
    } else {
      const { data } = await supabase
        .from("voucher_items")
        .select("item_id, qty")
        .eq("voucher_id", v.id);
      items = (data ?? []) as Array<{ item_id: string; qty: number }>;
    }

    for (const item of items) {
      consumed.set(item.item_id, (consumed.get(item.item_id) || 0) + item.qty);
    }
  }

  return allLines.map((l) => {
    const totalQty = Number(l.qty);
    const consumedQty = consumed.get(l.item_id) || 0;
    return {
      ...l,
      pending_qty: Math.max(0, totalQty - consumedQty),
    };
  });
}

