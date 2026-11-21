import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runAbnormalBalances, runStockReorder } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 5.3 (items below reorder level) and 7.5 (abnormal balances), as on 31 Mar 2026.
const CO = "co-reorder";
const ASOF = "2026-03-31";

describe("routing: reorder and abnormal balances", () => {
  it("routes the 5.3 wording to stock_reorder", () => {
    expect(routeQuery("Which items are below reorder level and need a purchase order raised?").intent).toBe("stock_reorder");
  });

  it("routes the 7.5 wording to abnormal_balances", () => {
    expect(
      routeQuery("Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)?").intent,
    ).toBe("abnormal_balances");
  });
});

describe("reorder and abnormal balance checks", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_items.clear(),
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
      offlineDb.cache_voucher_items.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_items.bulkPut([
      { id: "rice", company_id: CO, name: "Rice", unit: "KG", opening_stock_qty: 40, reorder_level: 50, updated_at: now },
      { id: "dal", company_id: CO, name: "Dal", unit: "KG", opening_stock_qty: 100, reorder_level: 20, updated_at: now },
      { id: "wheat", company_id: CO, name: "Wheat", unit: "KG", opening_stock_qty: 5, reorder_level: 0, updated_at: now },
    ] as never[]);
    await offlineDb.cache_vouchers.bulkPut([
      { id: "s1", company_id: CO, voucher_type: "sales", voucher_number: "1", voucher_date: "2026-03-10", total_paise: 0, is_deleted: false, updated_at: now },
    ] as never[]);
    await offlineDb.cache_voucher_items.bulkPut([
      { id: "l1", company_id: CO, voucher_id: "s1", item_id: "dal", qty: 5, rate_paise: 100, is_deleted: false },
    ] as never[]);
    const led = (id: string, name: string, type: string) => ({
      id, company_id: CO, name, type, group_name: type, opening_balance_paise: 0, opening_balance_is_debit: true, is_deleted: false, updated_at: now,
    });
    await offlineDb.cache_ledgers.bulkPut([
      led("sales", "Sales", "income_direct"),
      led("rent", "Rent", "expense_indirect"),
      led("debtor", "Rahul Traders", "sundry_debtor"),
      led("creditor", "Ajay Suppliers", "sundry_creditor"),
      led("cash", "Cash", "cash"),
      led("duty", "GST Payable", "duties_taxes"),
    ] as never[]);
    const ent = (id: string, ledger: string, dr: number, cr: number) => ({
      id: `e-${id}`, company_id: CO, voucher_id: "s1", ledger_id: ledger, debit_paise: dr, credit_paise: cr, is_deleted: false,
    });
    await offlineDb.cache_voucher_entries.bulkPut([
      ent("1", "sales", 50000, 0), // Sales with a debit balance: abnormal
      ent("2", "rent", 0, 20000), // Rent with a credit balance: abnormal
      ent("3", "debtor", 100000, 0), // normal
      ent("4", "creditor", 30000, 0), // Creditor in debit: abnormal
      ent("5", "cash", 10000, 0), // normal
      ent("6", "duty", 7000, 0), // not checked
    ] as never[]);
  });

  it("lists items at or below their reorder level, with the shortfall", async () => {
    const res = await runStockReorder({ companyId: CO, asOn: ASOF });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.itemsWithLevel).toBe(2);
    expect(res.rows.map((r) => r.item)).toEqual(["Rice"]);
    expect(res.rows[0].shortfall).toBe(10);
  });

  it("flags ledgers on the side opposite to their normal side, and no others", async () => {
    const res = await runAbnormalBalances({ companyId: CO, asOn: ASOF });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.rows.map((r) => r.ledger).sort()).toEqual(["Ajay Suppliers", "Rent", "Sales"]);
    const byName = Object.fromEntries(res.rows.map((r) => [r.ledger, r]));
    expect(byName.Sales.actual).toBe("Dr");
    expect(byName.Sales.expected).toBe("Cr");
    expect(byName.Rent.actual).toBe("Cr");
  });

  it("reports an invalid date instead of guessing", async () => {
    expect((await runStockReorder({ companyId: CO, asOn: "31/02/2026" })).status).toBe("invalid_date");
    expect((await runAbnormalBalances({ companyId: CO, asOn: "31/02/2026" })).status).toBe("invalid_date");
  });
});
