import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import {
  buildTransferPreview,
  applyTransferPreview,
  extendFinancialYearLocal,
} from "@/lib/offline/fy-transfer";

const SRC = "src-co";
const FY_END = "2026-03-31";
const NEXT_START = "2026-04-01";

async function clearAll() {
  await Promise.all([
    db.cache_companies.clear(),
    db.companies.clear(),
    db.cache_ledgers.clear(),
    db.cache_items.clear(),
    db.cache_vouchers.clear(),
    db.cache_voucher_entries.clear(),
    db.cache_voucher_items.clear(),
  ]);
}

async function seedSource() {
  await db.cache_companies.put({
    id: SRC, company_id: SRC, name: "Acme", financial_year_start: "2025-04-01",
    gst_registered: true, currency_code: "INR", date_format: "dd-mm-yyyy",
  });
  await db.cache_ledgers.bulkPut([
    { id: "L-cash", company_id: SRC, name: "CASH", type: "cash", group_code: "CASH", opening_balance_paise: 100000, opening_balance_is_debit: true },
    { id: "L-cap", company_id: SRC, name: "CAPITAL", type: "capital", group_code: "CAPITAL", opening_balance_paise: 100000, opening_balance_is_debit: false },
    { id: "L-party", company_id: SRC, name: "PARTY", type: "sundry_debtor", group_code: "SUNDRY_DEBTORS", opening_balance_paise: 0, opening_balance_is_debit: true },
    { id: "L-sales", company_id: SRC, name: "SALES", type: "income_direct", group_code: "SALES", opening_balance_paise: 0, opening_balance_is_debit: false },
  ]);
  // Past-year sales: cash 500 in, sales 500 (Jan 2026). After year end: must be ignored.
  await db.cache_vouchers.bulkPut([
    { id: "V1", company_id: SRC, voucher_date: "2026-01-10", voucher_type: "sales", is_deleted: false },
    { id: "V2", company_id: SRC, voucher_date: "2026-05-01", voucher_type: "receipt", is_deleted: false },
  ]);
  await db.cache_voucher_entries.bulkPut([
    { id: "E1", voucher_id: "V1", ledger_id: "L-cash", debit_paise: 50000, credit_paise: 0 },
    { id: "E2", voucher_id: "V1", ledger_id: "L-sales", debit_paise: 0, credit_paise: 50000 },
    { id: "E3", voucher_id: "V2", ledger_id: "L-cash", debit_paise: 0, credit_paise: 20000 },
    { id: "E4", voucher_id: "V2", ledger_id: "L-party", debit_paise: 20000, credit_paise: 0 },
  ]);
}

async function createNext() {
  const p = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "Acme FY 26-27" });
  return applyTransferPreview(p);
}

describe("FY transfer (local)", () => {
  beforeEach(async () => {
    await clearAll();
    await seedSource();
  });

  it("first run creates the next-year company with closing balances only", async () => {
    const preview = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "Acme FY 26-27" });
    expect(preview.targetId).toBeNull();
    expect(preview.netProfitPaise).toBe(50000);

    const tid = await applyTransferPreview(preview);
    const co = await db.cache_companies.get(tid);
    expect(co.carried_from_company_id).toBe(SRC);
    expect(co.financial_year_start).toBe(NEXT_START);

    const cash = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "CASH");
    // 1000 Dr + 500 in (Jan) - 200 receipt (May, after year end ignored) = 1500 Dr
    expect(cash.opening_balance_paise).toBe(150000);
    expect(cash.opening_balance_is_debit).toBe(true);

    const pl = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "Profit & Loss A/c");
    expect(pl.opening_balance_paise).toBe(50000);
    expect(pl.opening_balance_is_debit).toBe(false);
  });

  it("later runs refresh the same company and do not create a duplicate", async () => {
    const tid = await createNext();

    // Accountant changes last year after the first transfer.
    await db.cache_vouchers.put({ id: "V3", company_id: SRC, voucher_date: "2026-02-01", voucher_type: "sales", is_deleted: false });
    await db.cache_voucher_entries.bulkPut([
      { id: "E5", voucher_id: "V3", ledger_id: "L-cash", debit_paise: 10000, credit_paise: 0 },
      { id: "E6", voucher_id: "V3", ledger_id: "L-sales", debit_paise: 0, credit_paise: 10000 },
    ]);

    const preview = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "x" });
    expect(preview.targetId).toBe(tid);
    expect(preview.ledgers.change).toContain("CASH");
    expect(preview.ledgers.add).toHaveLength(0);

    await applyTransferPreview(preview);
    const companies = (await db.cache_companies.toArray()).filter((c: any) => c.carried_from_company_id === SRC);
    expect(companies).toHaveLength(1);

    const cash = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "CASH");
    expect(cash.opening_balance_paise).toBe(160000);
    const pl = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "Profit & Loss A/c");
    expect(pl.opening_balance_paise).toBe(60000);
  });

  it("keeps rows added in the new year and keeps carried rows that new-year vouchers use", async () => {
    const tid = await createNext();
    await db.cache_ledgers.put({ id: "NEW-BANK", company_id: tid, name: "New Bank", type: "bank", group_code: "BANK", opening_balance_paise: 0, opening_balance_is_debit: true });
    const carriedParty = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "PARTY");
    await db.cache_vouchers.put({ id: "NV1", company_id: tid, voucher_date: "2026-06-01", voucher_type: "sales", is_deleted: false });
    await db.cache_voucher_entries.put({ id: "NE1", voucher_id: "NV1", ledger_id: carriedParty.id, debit_paise: 100, credit_paise: 0 });

    // Source drops PARTY; the next-year company still uses it, so it must stay.
    await db.cache_ledgers.update("L-party", { is_deleted: true });
    const preview = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "x" });
    expect(preview.ledgers.keptInUse).toContain("PARTY");
    expect(preview.ledgers.remove).not.toContain("PARTY");
    await applyTransferPreview(preview);

    const names = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).map((l: any) => l.name);
    expect(names).toContain("New Bank");
    expect(names).toContain("PARTY");
  });

  it("reports hand-edited carried balances and replaces them on refresh", async () => {
    const tid = await createNext();
    const cash = (await db.cache_ledgers.where("company_id").equals(tid).toArray()).find((l: any) => l.name === "CASH");
    await db.cache_ledgers.update(cash.id, { opening_balance_paise: 99900 });

    const preview = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "x" });
    expect(preview.ledgers.handEdited).toContain("CASH");
    await applyTransferPreview(preview);

    const after = await db.cache_ledgers.get(cash.id);
    expect(after.opening_balance_paise).toBe(150000);
  });

  it("does not carry a ledger whose name is already a new-year row", async () => {
    const tid = await createNext();
    await db.cache_ledgers.put({ id: "M-1", company_id: tid, name: "Party", type: "sundry_debtor", group_code: "SUNDRY_DEBTORS", opening_balance_paise: 0, opening_balance_is_debit: true });
    await db.cache_ledgers.update("L-party", { is_deleted: false });
    // Re-run: PARTY is carried from source, but the new year has a manual "Party" (same name, different row).
    await db.cache_ledgers.where("company_id").equals(tid).filter((l: any) => l.carry_source_id === "L-party").delete();
    const preview = await buildTransferPreview({ sourceId: SRC, fyEnd: FY_END, nextFyStart: NEXT_START, nextName: "x" });
    expect(preview.ledgers.clashes).toContain("PARTY");
  });

  it("extend mode only moves the financial-year start", async () => {
    await extendFinancialYearLocal(SRC, NEXT_START);
    const co = await db.cache_companies.get(SRC);
    expect(co.financial_year_start).toBe(NEXT_START);
    expect(await db.cache_companies.count()).toBe(1);
  });
});
