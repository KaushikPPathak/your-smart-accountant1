import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runDuplicateCheck } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 3.4: duplicate bill numbers, repeat payments and unusual purchase prices. Paise throughout.
const CO = "co-dup";

describe("routing: duplicates and unusual prices", () => {
  it("routes the questionnaire wording to duplicate_check", () => {
    expect(routeQuery("Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor?").intent).toBe(
      "duplicate_check",
    );
  });

  it("keeps the vendor overdue question on its own intent", () => {
    expect(routeQuery("Which vendors have overdue balances or unadjusted debit notes/advances?").intent).toBe("vendor_overdue");
  });
});

describe("duplicate bills, repeat payments and price jumps", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
      offlineDb.cache_voucher_items.clear(),
      offlineDb.cache_items.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "kumar", company_id: CO, name: "Kumar Supplies", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
      { id: "rao", company_id: CO, name: "Rao Trading", group_name: "Sundry Creditors", opening_balance_paise: 0, opening_balance_is_debit: false, updated_at: now },
    ] as never[]);
    await offlineDb.cache_items.bulkPut([{ id: "basmati", company_id: CO, name: "Basmati Rice", updated_at: now }] as never[]);

    const v = (id: string, type: string, date: string, party: string, ref: string, total: number) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: id,
      voucher_date: date,
      party_ledger_id: party,
      ref_no: ref,
      total_paise: total,
      is_deleted: false,
      updated_at: now,
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("p1", "purchase", "2026-01-10", "kumar", "KS-101", 500_000),
      v("p2", "purchase", "2026-02-10", "kumar", "ks-101", 300_000), // same bill number, different case
      v("p3", "purchase", "2026-03-10", "kumar", "", 200_000), // no bill number: counted, not compared
      v("p4", "purchase", "2026-04-02", "rao", "RT-7", 100_000),
      v("pay1", "payment", "2026-03-01", "rao", "", 50_000),
      v("pay2", "payment", "2026-03-20", "rao", "", 50_000), // same amount, 19 days later: repeat
      v("pay3", "payment", "2026-06-15", "rao", "", 50_000), // same amount, months later: not a repeat
      v("pay4", "payment", "2026-03-05", "kumar", "", 70_000), // a single payment: not a repeat
    ] as never[]);

    const item = (id: string, voucher: string, rate: number) => ({
      id: `${voucher}-line`,
      company_id: CO,
      voucher_id: voucher,
      item_id: "basmati",
      qty: 10,
      rate_paise: rate,
      is_deleted: false,
    });
    await offlineDb.cache_voucher_items.bulkPut([
      item("i1", "p1", 10_000), // 100 a unit
      item("i2", "p2", 13_000), // 130: +30% on the previous Kumar rate
      item("i4", "p4", 12_000), // Rao buys at 120 (first purchase for Rao: no comparison)
    ] as never[]);
  });

  it("finds bill numbers repeated for the same vendor, ignoring case, and counts purchases without a number", async () => {
    const res = await runDuplicateCheck({ companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.duplicateBills).toEqual([
      expect.objectContaining({ vendor: "Kumar Supplies", billNo: "KS-101", voucherIds: ["p1", "p2"], totalPaise: 800_000 }),
    ]);
    expect(res.purchaseCount).toBe(4);
    expect(res.purchasesWithoutBillNo).toBe(1);
  });

  it("flags payments of the same amount to the same vendor only within the window", async () => {
    const res = await runDuplicateCheck({ companyId: CO });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.repeatPayments).toEqual([
      expect.objectContaining({ vendor: "Rao Trading", amountPaise: 50_000, voucherIds: ["pay1", "pay2"], dates: ["2026-03-01", "2026-03-20"] }),
    ]);
  });

  it("flags a purchase rate more than 25% above the vendor's previous rate, and not the first purchase", async () => {
    const res = await runDuplicateCheck({ companyId: CO });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.priceJumps).toEqual([
      expect.objectContaining({
        vendor: "Kumar Supplies",
        item: "Basmati Rice",
        date: "2026-02-10",
        previousRatePaise: 10_000,
        ratePaise: 13_000,
        changePct: 30,
      }),
    ]);
    expect(res.thresholds).toEqual({ priceJumpPct: 25, repeatPaymentWindowDays: 30 });
  });

  it("limits the check to the period when dates are given", async () => {
    const res = await runDuplicateCheck({ companyId: CO, from: "2026-03-01", to: "2026-04-30" });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.duplicateBills).toEqual([]);
    expect(res.priceJumps).toEqual([]);
    expect(res.purchaseCount).toBe(2);
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runDuplicateCheck({ companyId: CO, from: "31/02/2026" });
    expect(res.status).toBe("invalid_date");
  });
});
