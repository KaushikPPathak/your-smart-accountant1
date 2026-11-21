import { describe, expect, it } from "vitest";
import { settleParty, type PartyPosting, type RecordedAllocation } from "@/lib/ai/settlement";

const bill = (id: string, date: string, amount: number, type = "sales"): PartyPosting => ({ voucherId: id, date, debitPaise: amount, creditPaise: 0, voucherType: type });
const cr = (id: string, date: string, amount: number, type: string): PartyPosting => ({ voucherId: id, date, debitPaise: 0, creditPaise: amount, voucherType: type });
const dr = (id: string, date: string, amount: number, type: string): PartyPosting => ({ voucherId: id, date, debitPaise: amount, creditPaise: 0, voucherType: type });
const pbill = (id: string, date: string, amount: number): PartyPosting => ({ voucherId: id, date, debitPaise: 0, creditPaise: amount, voucherType: "purchase" });
const alloc = (invoice: string, payment: string, amount: number): RecordedAllocation => ({ invoiceVoucherId: invoice, paymentVoucherId: payment, amountPaise: amount });
const ASON = "2026-06-30";

describe("settlement: FIFO when nothing is allocated", () => {
  it("settles the oldest bills first and leaves the rest open", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), bill("B", "2026-02-01", 50_000), cr("R", "2026-02-10", 120_000, "receipt")],
      allocations: [],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "B", openPaise: 30_000 })]);
    expect(r.applications.map((a) => [a.billId, a.amountPaise, a.method])).toEqual([["A", 100_000, "fifo"], ["B", 20_000, "fifo"]]);
    expect(r.allocatedPaise).toBe(0);
    expect(r.fifoPaise).toBe(120_000);
    expect(r.unallocatedSettlementPaise).toBe(120_000);
    expect(r.netPaise).toBe(30_000);
  });
});

describe("settlement: recorded allocations come first", () => {
  it("an allocation to a later bill is honoured even though FIFO would have used the earlier one", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), bill("B", "2026-01-05", 100_000), cr("R", "2026-01-10", 100_000, "receipt")],
      allocations: [alloc("B", "R", 100_000)],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 100_000 })]);
    expect(r.applications).toEqual([expect.objectContaining({ billId: "B", amountPaise: 100_000, method: "allocation" })]);
    expect(r.allocatedPaise).toBe(100_000);
    expect(r.fifoPaise).toBe(0);
  });

  it("a partial payment against one bill leaves the rest of that bill open", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), cr("R", "2026-01-10", 30_000, "receipt")],
      allocations: [alloc("A", "R", 30_000)],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 70_000 })]);
    expect(r.netPaise).toBe(70_000);
  });

  it("one receipt spread across two bills by two allocations", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), bill("B", "2026-01-05", 50_000), cr("R", "2026-01-10", 150_000, "receipt")],
      allocations: [alloc("A", "R", 100_000), alloc("B", "R", 50_000)],
    });
    expect(r.openBills).toEqual([]);
    expect(r.applications.map((a) => [a.billId, a.amountPaise, a.method])).toEqual([["A", 100_000, "allocation"], ["B", 50_000, "allocation"]]);
    expect(r.unallocatedSettlementPaise).toBe(0);
    expect(r.netPaise).toBe(0);
  });

  it("an unallocated payment is FIFO only for what the allocations left", () => {
    // R = 150,000: 100,000 allocated to B; the other 50,000 is FIFO, so it settles A.
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), bill("B", "2026-01-05", 100_000), cr("R", "2026-01-10", 150_000, "receipt")],
      allocations: [alloc("B", "R", 100_000)],
    });
    expect(r.allocatedPaise).toBe(100_000);
    expect(r.fifoPaise).toBe(50_000);
    expect(r.unallocatedSettlementPaise).toBe(50_000);
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 50_000 })]);
  });
});

describe("settlement: invalid allocations are reported and not applied", () => {
  const base = {
    side: "receivable" as const, openingPaise: 0, asOn: ASON,
    postings: [bill("A", "2026-01-20", 100_000), cr("R", "2026-01-10", 100_000, "receipt")],
  };

  it("a bill dated after the receipt is not applied; FIFO still applies to the receipt", () => {
    const r = settleParty({ ...base, allocations: [alloc("A", "R", 100_000)] });
    expect(r.invalid).toEqual([expect.objectContaining({ reason: "bill_after_settlement", excessPaise: 100_000 })]);
    expect(r.allocatedPaise).toBe(0);
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 100_000 })]);
  });

  it("an allocation to a bill that is not on this ledger is reported", () => {
    const r = settleParty({ ...base, allocations: [alloc("ZZ", "R", 50_000)] });
    expect(r.invalid).toEqual([expect.objectContaining({ reason: "bill_not_on_ledger" })]);
  });

  it("an allocation from a voucher that is not on this ledger is reported", () => {
    const r = settleParty({ ...base, allocations: [alloc("A", "NOPE", 50_000)] });
    expect(r.invalid).toEqual([expect.objectContaining({ reason: "settlement_not_on_ledger" })]);
  });

  it("a zero or negative allocation is reported", () => {
    const r = settleParty({ ...base, allocations: [alloc("A", "R", 0)] });
    expect(r.invalid).toEqual([expect.objectContaining({ reason: "non_positive_amount" })]);
  });

  it("an allocation larger than the bill applies what fits and reports the excess", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), cr("R", "2026-01-10", 200_000, "receipt")],
      allocations: [alloc("A", "R", 150_000)],
    });
    expect(r.invalid).toEqual([expect.objectContaining({ reason: "exceeds_open_amount_or_settlement", amountPaise: 150_000, excessPaise: 50_000 })]);
    expect(r.allocatedPaise).toBe(100_000);
    expect(r.unmatched.customer_advance).toBe(100_000);
  });
});

describe("settlement: opening balances", () => {
  it("an opening receivable is a bill of unknown age, settled FIFO first", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 50_000, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), cr("R", "2026-02-01", 80_000, "receipt")],
      allocations: [],
    });
    expect(r.applications[0]).toMatchObject({ billId: null, billDate: null, amountPaise: 50_000, method: "fifo" });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 70_000 })]);
  });

  it("a negative opening receivable is a customer advance, reported separately", () => {
    const r = settleParty({ side: "receivable", openingPaise: -20_000, asOn: ASON, postings: [], allocations: [] });
    expect(r.unmatched.customer_advance).toBe(20_000);
    expect(r.netPaise).toBe(-20_000);
  });

  it("an opening payable is owed to the vendor and settled by a payment", () => {
    const r = settleParty({
      side: "payable", openingPaise: 40_000, asOn: ASON,
      postings: [cr("OPEN-BILL", "2026-01-01", 0, "purchase"), dr("P", "2026-03-01", 25_000, "payment")],
      allocations: [],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: null, openPaise: 15_000 })]);
  });
});

describe("settlement: categories stay separate", () => {
  it("receivable: unmatched receipts and unmatched credit notes are reported apart", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 100_000), cr("R", "2026-02-01", 150_000, "receipt"), cr("CN", "2026-02-05", 30_000, "credit_note")],
      allocations: [],
    });
    expect(r.unmatched.customer_advance).toBe(50_000); // 150,000 receipt less the 100,000 bill
    expect(r.unmatched.customer_credit_note).toBe(30_000);
    expect(r.unmatched.vendor_advance).toBe(0);
  });

  it("payable: unmatched payments and unmatched debit notes are reported apart", () => {
    const r = settleParty({
      side: "payable", openingPaise: 0, asOn: ASON,
      postings: [pbill("B", "2026-01-01", 50_000), dr("P", "2026-02-01", 70_000, "payment"), dr("DN", "2026-02-05", 10_000, "debit_note")],
      allocations: [],
    });
    expect(r.unmatched.vendor_advance).toBe(20_000);
    expect(r.unmatched.vendor_debit_note).toBe(10_000);
    expect(r.unmatched.customer_advance).toBe(0);
  });

  it("a journal credit on a receivable is other_unmatched, not an advance", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [cr("J", "2026-02-01", 5_000, "journal")], allocations: [],
    });
    expect(r.unmatched.other_unmatched).toBe(5_000);
    expect(r.unmatched.customer_advance).toBe(0);
  });
});

describe("settlement: reconciliation and rules", () => {
  it("net equals opening plus bills less settlements, in the party's own direction", () => {
    const postings = [bill("A", "2026-01-01", 100_000), cr("R", "2026-02-01", 130_000, "receipt"), cr("CN", "2026-02-02", 10_000, "credit_note"), bill("B", "2026-03-01", 40_000)];
    const r = settleParty({ side: "receivable", openingPaise: 25_000, asOn: ASON, postings, allocations: [alloc("A", "R", 60_000)] });
    const expected = 25_000 + 100_000 + 40_000 - (130_000 + 10_000);
    expect(r.netPaise).toBe(expected);
  });

  it("postings after the as-on date are ignored", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: "2026-01-31",
      postings: [bill("A", "2026-01-01", 100_000), cr("R", "2026-02-10", 100_000, "receipt")], allocations: [],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", openPaise: 100_000 })]);
  });

  it("several lines of one voucher count as one bill", () => {
    const r = settleParty({
      side: "receivable", openingPaise: 0, asOn: ASON,
      postings: [bill("A", "2026-01-01", 60_000), bill("A", "2026-01-01", 40_000)], allocations: [],
    });
    expect(r.openBills).toEqual([expect.objectContaining({ id: "A", originalPaise: 100_000, openPaise: 100_000 })]);
  });

  it("does not change its inputs (read-only)", () => {
    const postings = [bill("A", "2026-01-01", 100_000), cr("R", "2026-02-01", 60_000, "receipt")];
    const allocations = [alloc("A", "R", 60_000)];
    const before = JSON.stringify({ postings, allocations });
    settleParty({ side: "receivable", openingPaise: 0, asOn: ASON, postings, allocations });
    expect(JSON.stringify({ postings, allocations })).toBe(before);
  });
});
