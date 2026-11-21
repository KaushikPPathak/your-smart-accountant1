import { beforeEach, describe, expect, it } from "vitest";
import { runPartySummary, runVendorOverdue, runVendorSpendCycle } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Payment-cycle and reconciliation tests. All amounts in paise. As on 30 Apr 2026 unless stated.
const CO = "co-recon";
const ASOF = "2026-04-30";

type Voucher = [id: string, type: string, date: string];
type Entry = [voucherId: string, ledgerId: string, debit: number, credit: number];
type Alloc = [invoiceId: string, paymentId: string, ledgerId: string, amount: number];

function ledger(id: string, name: string, group: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    company_id: CO,
    name,
    group_name: group,
    opening_balance_paise: 0,
    opening_balance_is_debit: true,
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

const BASE_LEDGERS = [
  ledger("sales", "Sales Account", "Sales Accounts", { opening_balance_is_debit: false }),
  ledger("purch", "Purchase Account", "Purchase Accounts"),
  ledger("pret", "Purchase Returns", "Purchase Accounts", { opening_balance_is_debit: false }),
  ledger("adj", "Adjustments", "Indirect Expenses"),
  ledger("bank", "HDFC Bank", "Bank Accounts"),
];

async function seed(opts: {
  ledgers?: unknown[];
  vouchers: Voucher[];
  entries: Entry[];
  allocations?: Alloc[];
  extraEntries?: Array<Record<string, unknown>>;
}) {
  localStorage.setItem("ym_active_company_id", CO);
  await Promise.all([
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.cache_bill_allocations.clear(),
  ]);
  const now = new Date().toISOString();
  await offlineDb.cache_ledgers.bulkPut([...BASE_LEDGERS, ...(opts.ledgers ?? [])] as never[]);
  await offlineDb.cache_vouchers.bulkPut(
    opts.vouchers.map(([id, type, date]) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: id,
      voucher_date: date,
      total_paise: 0,
      is_deleted: false,
      updated_at: now,
    })) as never[],
  );
  const entries = opts.entries.map(([voucherId, ledgerId, debit, credit], i) => ({
    id: `${voucherId}-${ledgerId}-${i}`,
    company_id: CO,
    voucher_id: voucherId,
    ledger_id: ledgerId,
    debit_paise: debit,
    credit_paise: credit,
    is_deleted: false,
  }));
  await offlineDb.cache_voucher_entries.bulkPut([...entries, ...(opts.extraEntries ?? [])] as never[]);
  if (opts.allocations?.length) {
    await offlineDb.cache_bill_allocations.bulkPut(
      opts.allocations.map(([inv, pay, lid, amount], i) => ({
        id: `alloc-${i}`,
        company_id: CO,
        invoice_voucher_id: inv,
        payment_voucher_id: pay,
        ledger_id: lid,
        amount_paise: amount,
      })) as never[],
    );
  }
}

type PartyRow = Extract<Awaited<ReturnType<typeof runPartySummary>>, { status: "resolved" }>["rows"][number];

async function receivableRow(name: string, asOn = ASOF): Promise<PartyRow> {
  const res = await runPartySummary({ side: "receivable", asOn, companyId: CO });
  if (res.status !== "resolved") throw new Error(`not resolved: ${res.status}`);
  const row = res.rows.find((r) => r.name === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

async function payableRow(name: string, asOn = ASOF): Promise<PartyRow> {
  const res = await runPartySummary({ side: "payable", asOn, companyId: CO });
  if (res.status !== "resolved") throw new Error(`not resolved: ${res.status}`);
  const row = res.rows.find((r) => r.name === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

// Ram Traders: sale 10,000 on 5 Jan; sale 5,000 on 1 Feb; receipt 5,000 on 1 Mar allocated to the Feb bill.
const RAM = ledger("ram", "Ram Traders", "Sundry Debtors", { credit_limit_paise: 1_000_000 });
const ramBase = {
  ledgers: [RAM],
  vouchers: [
    ["s1", "sales", "2026-01-05"],
    ["s2", "sales", "2026-02-01"],
    ["r1", "receipt", "2026-03-01"],
  ] as Voucher[],
  entries: [
    ["s1", "ram", 1_000_000, 0],
    ["s1", "sales", 0, 1_000_000],
    ["s2", "ram", 500_000, 0],
    ["s2", "sales", 0, 500_000],
    ["r1", "bank", 500_000, 0],
    ["r1", "ram", 0, 500_000],
  ] as Entry[],
};

describe("receivables: recorded allocations first, FIFO only for the rest", () => {
  beforeEach(async () => {
    await seed({ ...ramBase, allocations: [["s2", "r1", "ram", 500_000]] });
  });

  it("applies the recorded allocation to its own bill, not the oldest one", async () => {
    const r = await receivableRow("Ram Traders");
    expect(r.outstandingPaise).toBe(1_000_000);
    expect(r.allocatedPaise).toBe(500_000);
    expect(r.fifoPaise).toBe(0);
    expect(r.buckets.d90p).toBe(1_000_000);
  });

  it("reports the recorded allocation as a live allocation, not an invalid one", async () => {
    const r = await receivableRow("Ram Traders");
    expect(r.invalidAllocations).toBe(0);
  });
});

describe("receivables: unallocated receipts settle the oldest bill first", () => {
  it("uses FIFO for a receipt with no recorded allocation and says so", async () => {
    await seed({
      ...ramBase,
      vouchers: [...ramBase.vouchers, ["r2", "receipt", "2026-03-10"]],
      entries: [...ramBase.entries, ["r2", "bank", 300_000, 0], ["r2", "ram", 0, 300_000]],
      allocations: [["s2", "r1", "ram", 500_000]],
    });
    const r = await receivableRow("Ram Traders");
    expect(r.outstandingPaise).toBe(700_000);
    expect(r.fifoPaise).toBe(300_000);
    expect(r.allocatedPaise).toBe(500_000);
    expect(r.advancePaise).toBe(0);
  });

  it("handles partial payments across several bills", async () => {
    await seed({
      ...ramBase,
      vouchers: [...ramBase.vouchers, ["r3", "receipt", "2026-03-12"]],
      entries: [...ramBase.entries, ["r3", "bank", 800_000, 0], ["r3", "ram", 0, 800_000]],
    });
    const r = await receivableRow("Ram Traders");
    // Bills 10,000 (Jan) + 5,000 (Feb). Receipts 5,000 (r1) + 8,000 (r3), none allocated: FIFO takes 13,000,
    // clearing the January bill and 3,000 of the February bill. 2,000 stays open.
    expect(r.outstandingPaise).toBe(200_000);
    expect(r.fifoPaise).toBe(1_300_000);
    expect(r.advancePaise).toBe(0);
  });
});

describe("receivables: unmatched amounts stay in their own categories", () => {
  it("a receipt with no bill to settle is a customer advance, separate from outstanding", async () => {
    await seed({
      ledgers: [ledger("adv", "Advance Party", "Sundry Debtors")],
      vouchers: [["r9", "receipt", "2026-03-01"]],
      entries: [
        ["r9", "bank", 200_000, 0],
        ["r9", "adv", 0, 200_000],
      ],
    });
    const r = await receivableRow("Advance Party");
    expect(r.outstandingPaise).toBe(0);
    expect(r.advancePaise).toBe(200_000);
    expect(r.customerCreditNotePaise).toBe(0);
    expect(r.netPaise).toBe(-200_000);
  });

  it("a credit note with no bill to settle is a customer credit note, not an advance", async () => {
    await seed({
      ledgers: [ledger("dhanu", "Dhanu Stores", "Sundry Debtors")],
      vouchers: [["cn1", "credit_note", "2026-03-01"]],
      entries: [
        ["cn1", "pret", 150_000, 0],
        ["cn1", "dhanu", 0, 150_000],
      ],
    });
    const r = await receivableRow("Dhanu Stores");
    expect(r.customerCreditNotePaise).toBe(150_000);
    expect(r.advancePaise).toBe(0);
    expect(r.netPaise).toBe(-150_000);
  });
});

describe("receivables: credit days and ageing", () => {
  it("uses the ledger's own credit days, so a 41-day-old bill is not overdue on 45 credit days", async () => {
    await seed({
      ledgers: [ledger("gup", "Gupta Stores", "Sundry Debtors", { credit_days: 45 })],
      vouchers: [["s5", "sales", "2026-03-20"]],
      entries: [
        ["s5", "gup", 300_000, 0],
        ["s5", "sales", 0, 300_000],
      ],
    });
    const r = await receivableRow("Gupta Stores");
    expect(r.creditDays).toBe(45);
    expect(r.creditDaysSource).toBe("ledger");
    expect(r.outstandingPaise).toBe(300_000);
    expect(r.overduePaise).toBe(0);
  });

  it("falls back to 30 days where the ledger sets none, and says so", async () => {
    await seed({ ...ramBase, allocations: [["s2", "r1", "ram", 500_000]] });
    const r = await receivableRow("Ram Traders");
    expect(r.creditDays).toBe(30);
    expect(r.creditDaysSource).toBe("default_30");
    expect(r.overduePaise).toBe(1_000_000);
  });

  it("reports an opening balance as overdue and does not time it", async () => {
    await seed({
      ledgers: [ledger("open", "Opening Co", "Sundry Debtors", { opening_balance_paise: 500_000, opening_balance_is_debit: true })],
      vouchers: [],
      entries: [],
    });
    const r = await receivableRow("Opening Co");
    expect(r.buckets.opening).toBe(500_000);
    expect(r.overduePaise).toBe(500_000);
    expect(r.outstandingPaise).toBe(500_000);
  });
});

describe("validation and reconciliation", () => {
  it("reports an invalid allocation and does not apply it", async () => {
    await seed({ ...ramBase, allocations: [["s2", "missing-receipt", "ram", 100_000]] });
    const r = await receivableRow("Ram Traders");
    expect(r.invalidAllocations).toBe(1);
    expect(r.allocatedPaise).toBe(0);
    // The rejected allocation leaves the 5,000 receipt unallocated, so FIFO applies it to the January bill.
    // Total open: 15,000 billed less 5,000 received = 10,000.
    expect(r.outstandingPaise).toBe(1_000_000);
    expect(r.fifoPaise).toBe(500_000);
  });

  it("reconciles to the ledger: later postings and orphan entries explain the whole difference", async () => {
    await seed({
      ...ramBase,
      vouchers: [...ramBase.vouchers, ["r5", "receipt", "2026-05-05"]],
      entries: [...ramBase.entries, ["r5", "bank", 100_000, 0], ["r5", "ram", 0, 100_000]],
      allocations: [["s2", "r1", "ram", 500_000]],
      extraEntries: [
        { id: "orphan-1", company_id: CO, voucher_id: "gone", ledger_id: "ram", debit_paise: 50_000, credit_paise: 0, is_deleted: false },
      ],
    });
    const r = await receivableRow("Ram Traders");
    const rec = r.reconciliation;
    expect(rec.netAsOnPaise).toBe(r.netPaise);
    expect(rec.postingsAfterAsOnPaise).toBe(-100_000);
    expect(rec.postingsAfterAsOnCount).toBe(1);
    expect(rec.orphanPaise).toBe(50_000);
    expect(rec.orphanCount).toBe(1);
    expect(rec.ledgerBalancePaise - rec.netAsOnPaise).toBe(rec.differencePaise);
    expect(rec.unexplainedPaise).toBe(0);
  });

  it("reports zero unexplained difference for a clean ledger", async () => {
    await seed({ ...ramBase, allocations: [["s2", "r1", "ram", 500_000]] });
    const r = await receivableRow("Ram Traders");
    expect(r.reconciliation.differencePaise).toBe(0);
    expect(r.reconciliation.unexplainedPaise).toBe(0);
  });

  it("does not change recorded allocations when reporting", async () => {
    await seed({ ...ramBase, allocations: [["s2", "r1", "ram", 500_000]] });
    const before = await offlineDb.cache_bill_allocations.toArray();
    await receivableRow("Ram Traders");
    await runPartySummary({ side: "receivable", asOn: ASOF, companyId: CO });
    const after = await offlineDb.cache_bill_allocations.toArray();
    expect(after).toEqual(before);
  });
});

describe("payables: vendor advances, debit notes and overdue", () => {
  const KUMAR = ledger("kumar", "Kumar Supplies", "Sundry Creditors");
  const RAO = ledger("rao", "Rao Trading", "Sundry Creditors");

  it("keeps vendor advances and debit notes in separate categories", async () => {
    await seed({
      ledgers: [RAO],
      vouchers: [
        ["pay-r", "payment", "2026-03-01"],
        ["dn-r", "debit_note", "2026-03-05"],
      ],
      entries: [
        ["pay-r", "rao", 200_000, 0],
        ["pay-r", "bank", 0, 200_000],
        ["dn-r", "rao", 100_000, 0],
        ["dn-r", "pret", 0, 100_000],
      ],
    });
    const r = await payableRow("Rao Trading");
    expect(r.advancePaise).toBe(200_000);
    expect(r.vendorDebitNotePaise).toBe(100_000);
    expect(r.customerCreditNotePaise).toBe(0);
    expect(r.outstandingPaise).toBe(0);
    expect(r.netPaise).toBe(-300_000);
    expect(r.reconciliation.differencePaise).toBe(0);
    expect(r.reconciliation.unexplainedPaise).toBe(0);
  });

  it("flags a vendor bill past the 30-day default and lists advances apart from overdue", async () => {
    await seed({
      ledgers: [KUMAR, RAO],
      vouchers: [
        ["p1", "purchase", "2026-01-10"],
        ["pay-r", "payment", "2026-03-01"],
        ["dn-r", "debit_note", "2026-03-05"],
      ],
      entries: [
        ["p1", "purch", 800_000, 0],
        ["p1", "kumar", 0, 800_000],
        ["pay-r", "rao", 200_000, 0],
        ["pay-r", "bank", 0, 200_000],
        ["dn-r", "rao", 100_000, 0],
        ["dn-r", "pret", 0, 100_000],
      ],
    });
    const res = await runVendorOverdue({ companyId: CO, asOn: ASOF });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    const kumar = res.flagged.find((f) => f.name === "Kumar Supplies");
    const rao = res.flagged.find((f) => f.name === "Rao Trading");
    expect(kumar?.overduePaise).toBe(800_000);
    expect(kumar?.creditDaysSource).toBe("default_30");
    expect(rao).toEqual(expect.objectContaining({ advancePaise: 200_000, debitNotePaise: 100_000, overduePaise: 0 }));
  });
});

describe("vendor spend and payment cycle (3.3)", () => {
  it("shows gross purchases, returns, debit adjustments and net separately, and times the allocated payment", async () => {
    await seed({
      ledgers: [ledger("kumar", "Kumar Supplies", "Sundry Creditors")],
      vouchers: [
        ["p1", "purchase", "2026-01-10"],
        ["pay1", "payment", "2026-02-09"],
        ["dn1", "debit_note", "2026-03-05"],
        ["jr1", "journal", "2026-03-08"],
      ],
      entries: [
        ["p1", "purch", 800_000, 0],
        ["p1", "kumar", 0, 800_000],
        ["pay1", "kumar", 800_000, 0],
        ["pay1", "bank", 0, 800_000],
        ["dn1", "kumar", 100_000, 0],
        ["dn1", "pret", 0, 100_000],
        ["jr1", "kumar", 50_000, 0],
        ["jr1", "adj", 0, 50_000],
      ],
      allocations: [["p1", "pay1", "kumar", 800_000]],
    });
    const res = await runVendorSpendCycle({ vendorName: "Kumar Supplies", from: "2026-01-01", to: "2026-04-30", companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.grossPurchasesPaise).toBe(800_000);
    expect(res.purchaseReturnsPaise).toBe(100_000);
    expect(res.debitAdjustmentsPaise).toBe(50_000);
    expect(res.netPurchasesPaise).toBe(650_000);
    expect(res.averageCycleDays).toBe(30);
    expect(res.allocatedPaise).toBe(800_000);
    expect(res.fifoPaise).toBe(0);
    expect(res.method).toBe("bill_allocations");
    expect(res.openingSettledPaise).toBe(0);
  });

  it("reports a payment that settled an opening balance and does not time it", async () => {
    await seed({
      ledgers: [ledger("old", "Old Vendor", "Sundry Creditors", { opening_balance_paise: 300_000, opening_balance_is_debit: false })],
      vouchers: [["pay2", "payment", "2026-02-15"]],
      entries: [
        ["pay2", "old", 300_000, 0],
        ["pay2", "bank", 0, 300_000],
      ],
    });
    const res = await runVendorSpendCycle({ vendorName: "Old Vendor", from: "2026-01-01", to: "2026-04-30", companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.openingSettledPaise).toBe(300_000);
    expect(res.averageCycleDays).toBeNull();
    expect(res.settledPaise).toBe(0);
  });
});
