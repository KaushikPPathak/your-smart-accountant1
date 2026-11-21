// Party settlement: which bills are still open, and what settled them.
//
// Read-only. Works on copies of the postings and allocations it is given; it never writes to the
// books or to cache_bill_allocations.
//
// Method (state it in every answer):
//   1. Recorded allocations first. A receipt or payment voucher that was entered against a bill
//      (cache_bill_allocations) is applied to that bill, up to the bill's open amount and the
//      voucher's unapplied amount. Invalid allocations are reported and not applied.
//   2. FIFO only for what is left. Each settlement's unallocated remainder is applied to the oldest
//      open bill dated on or before the settlement. Every FIFO application is labelled as such.
//   3. Anything still unapplied is reported by its own category. Categories are never combined:
//        receivable side: customer_advance (receipts), customer_credit_note (credit notes),
//                         other_unmatched (journals and other postings)
//        payable side:    vendor_advance (payments), vendor_debit_note (debit notes),
//                         other_unmatched
//   4. Opening balances have no date. An opening bill is applied by FIFO like any other bill, and
//      its age is unknown, so the caller treats it as overdue (and says so).
//
// Reconciliation: netPaise = open bills − unmatched equals the party's ledger balance, for the
// postings the caller supplies. The caller explains any difference from the ledger.

import type { AgingSide } from "./aging";

export type SettlementType = "receipt" | "payment" | "credit_note" | "debit_note" | "journal" | "other";
export type UnmatchedKind =
  | "customer_advance"
  | "customer_credit_note"
  | "vendor_advance"
  | "vendor_debit_note"
  | "other_unmatched";

export interface PartyPosting {
  voucherId: string;
  /** YYYY-MM-DD */
  date: string;
  debitPaise: number;
  creditPaise: number;
  voucherType: string;
}

export interface RecordedAllocation {
  invoiceVoucherId: string;
  paymentVoucherId: string;
  amountPaise: number;
}

export interface OpenBill {
  /** Bill voucher id, or null for the opening balance. */
  id: string | null;
  /** Bill date, or null for the opening balance. */
  date: string | null;
  originalPaise: number;
  openPaise: number;
}

export interface SettlementApplication {
  settlementVoucherId: string;
  settlementDate: string;
  settlementType: SettlementType;
  billId: string | null;
  billDate: string | null;
  amountPaise: number;
  method: "allocation" | "fifo";
}

export type InvalidReason =
  | "settlement_not_on_ledger"
  | "bill_not_on_ledger"
  | "bill_after_settlement"
  | "non_positive_amount"
  | "exceeds_open_amount_or_settlement";

export interface InvalidAllocation {
  invoiceVoucherId: string;
  paymentVoucherId: string;
  amountPaise: number;
  /** Part of the allocation that could not be applied. */
  excessPaise: number;
  reason: InvalidReason;
}

export interface SettlementRemainder {
  voucherId: string;
  date: string;
  type: SettlementType;
  remainingPaise: number;
}

export interface SettleInput {
  side: AgingSide;
  /** Opening balance in the party's direction: positive means the party owes us (receivable) or we owe them (payable). */
  openingPaise: number;
  postings: PartyPosting[];
  allocations: RecordedAllocation[];
  asOn: string;
}

export interface SettleResult {
  openBills: OpenBill[];
  applications: SettlementApplication[];
  allocatedPaise: number;
  fifoPaise: number;
  /** Settlement amounts that no recorded allocation covered (before FIFO). */
  unallocatedSettlementPaise: number;
  unmatched: Record<UnmatchedKind, number>;
  invalid: InvalidAllocation[];
  /** Open bills minus unmatched amounts: equals the party's balance in its own direction. */
  netPaise: number;
  settlementRemainders: SettlementRemainder[];
}

export function emptyUnmatched(): Record<UnmatchedKind, number> {
  return { customer_advance: 0, customer_credit_note: 0, vendor_advance: 0, vendor_debit_note: 0, other_unmatched: 0 };
}

export function settlementTypeOf(voucherType: string): SettlementType {
  switch (voucherType) {
    case "receipt":
    case "payment":
    case "credit_note":
    case "debit_note":
    case "journal":
      return voucherType as SettlementType;
    default:
      return "other";
  }
}

export function unmatchedKindFor(side: AgingSide, type: SettlementType): UnmatchedKind {
  if (side === "receivable") {
    if (type === "receipt") return "customer_advance";
    if (type === "credit_note") return "customer_credit_note";
    return "other_unmatched";
  }
  if (type === "payment") return "vendor_advance";
  if (type === "debit_note") return "vendor_debit_note";
  return "other_unmatched";
}

export function settleParty(input: SettleInput): SettleResult {
  const { side, asOn } = input;
  // Receivable bills are debits; payable bills are credits. The other side settles them.
  const billIsDebit = side === "receivable";

  // Aggregate by voucher: one bill or settlement per voucher, even if it has several lines here.
  const billsByVoucher = new Map<string, { date: string; amount: number; type: string }>();
  const settlementsByVoucher = new Map<string, { date: string; amount: number; type: SettlementType }>();
  for (const p of input.postings) {
    if (p.date > asOn) continue;
    const debit = Number(p.debitPaise ?? 0);
    const credit = Number(p.creditPaise ?? 0);
    const billing = billIsDebit ? debit : credit;
    const paying = billIsDebit ? credit : debit;
    if (billing > 0) {
      const cur = billsByVoucher.get(p.voucherId) ?? { date: p.date, amount: 0, type: p.voucherType };
      cur.amount += billing;
      billsByVoucher.set(p.voucherId, cur);
    }
    if (paying > 0) {
      const cur = settlementsByVoucher.get(p.voucherId) ?? { date: p.date, amount: 0, type: settlementTypeOf(p.voucherType) };
      cur.amount += paying;
      settlementsByVoucher.set(p.voucherId, cur);
    }
  }

  const unmatched = emptyUnmatched();
  const bills: OpenBill[] = [];
  if (input.openingPaise > 0) {
    bills.push({ id: null, date: null, originalPaise: input.openingPaise, openPaise: input.openingPaise });
  } else if (input.openingPaise < 0) {
    unmatched[side === "receivable" ? "customer_advance" : "vendor_advance"] += -input.openingPaise;
  }
  for (const [id, b] of billsByVoucher) bills.push({ id, date: b.date, originalPaise: b.amount, openPaise: b.amount });
  bills.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
  // Null (opening) dates sort first because "" < any date.

  const settlements = [...settlementsByVoucher.entries()]
    .map(([id, s]) => ({ voucherId: id, date: s.date, type: s.type, remaining: s.amount }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.voucherId.localeCompare(b.voucherId));
  const billById = new Map(bills.filter((b) => b.id !== null).map((b) => [b.id as string, b]));
  const settleById = new Map(settlements.map((s) => [s.voucherId, s]));

  const applications: SettlementApplication[] = [];
  const invalid: InvalidAllocation[] = [];
  let allocatedPaise = 0;

  // 1. Recorded allocations, in the order they were recorded.
  for (const a of input.allocations) {
    const amount = Number(a.amountPaise ?? 0);
    const base = { invoiceVoucherId: a.invoiceVoucherId, paymentVoucherId: a.paymentVoucherId, amountPaise: amount };
    if (!(amount > 0)) {
      invalid.push({ ...base, excessPaise: amount, reason: "non_positive_amount" });
      continue;
    }
    const s = settleById.get(a.paymentVoucherId);
    if (!s) {
      invalid.push({ ...base, excessPaise: amount, reason: "settlement_not_on_ledger" });
      continue;
    }
    const b = billById.get(a.invoiceVoucherId);
    if (!b) {
      invalid.push({ ...base, excessPaise: amount, reason: "bill_not_on_ledger" });
      continue;
    }
    if ((b.date ?? "") > s.date) {
      invalid.push({ ...base, excessPaise: amount, reason: "bill_after_settlement" });
      continue;
    }
    const apply = Math.min(amount, b.openPaise, s.remaining);
    if (apply > 0) {
      b.openPaise -= apply;
      s.remaining -= apply;
      allocatedPaise += apply;
      applications.push({
        settlementVoucherId: s.voucherId,
        settlementDate: s.date,
        settlementType: s.type,
        billId: b.id,
        billDate: b.date,
        amountPaise: apply,
        method: "allocation",
      });
    }
    if (apply < amount) {
      invalid.push({ ...base, excessPaise: amount - apply, reason: "exceeds_open_amount_or_settlement" });
    }
  }

  const unallocatedSettlementPaise = settlements.reduce((s, x) => s + x.remaining, 0);

  // 2. FIFO for each settlement's unallocated remainder: oldest eligible bill first.
  let fifoPaise = 0;
  for (const s of settlements) {
    for (const b of bills) {
      if (s.remaining <= 0) break;
      if (b.openPaise <= 0) continue;
      if (b.date !== null && b.date > s.date) continue;
      const take = Math.min(s.remaining, b.openPaise);
      b.openPaise -= take;
      s.remaining -= take;
      fifoPaise += take;
      applications.push({
        settlementVoucherId: s.voucherId,
        settlementDate: s.date,
        settlementType: s.type,
        billId: b.id,
        billDate: b.date,
        amountPaise: take,
        method: "fifo",
      });
    }
  }

  // 3. What is left is unmatched, by its own category.
  for (const s of settlements) {
    if (s.remaining > 0) unmatched[unmatchedKindFor(side, s.type)] += s.remaining;
  }

  const openBills = bills.filter((b) => b.openPaise > 0).map((b) => ({ ...b }));
  const openTotal = openBills.reduce((s, b) => s + b.openPaise, 0);
  const unmatchedTotal = Object.values(unmatched).reduce((s, v) => s + v, 0);

  return {
    openBills,
    applications,
    allocatedPaise,
    fifoPaise,
    unallocatedSettlementPaise,
    unmatched,
    invalid,
    netPaise: openTotal - unmatchedTotal,
    settlementRemainders: settlements.map((s) => ({ voucherId: s.voucherId, date: s.date, type: s.type, remainingPaise: s.remaining })),
  };
}
