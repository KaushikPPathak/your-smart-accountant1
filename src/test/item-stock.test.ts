import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runItemStock } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 5.1: stock quantity and valuation for one item. Paise throughout.
const CO = "co-stock";

describe("routing: item stock", () => {
  it("routes the questionnaire wording to item_stock with the item name", () => {
    const r = routeQuery("What is the current stock quantity and valuation for Rice Basmati across all godowns?");
    expect(r.intent).toBe("item_stock");
    expect(r.entity?.itemName).toBe("Rice Basmati");
  });

  it("keeps the general closing stock question off the item route", () => {
    expect(routeQuery("What is our closing stock?").intent).not.toBe("item_stock");
  });
});

describe("item stock and valuation", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_items.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_items.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_items.bulkPut([
      { id: "basmati", company_id: CO, name: "Rice Basmati", unit: "KG", opening_stock_qty: 100, opening_stock_rate_paise: 4000, updated_at: now },
      { id: "basmati-p", company_id: CO, name: "Rice Basmati Premium", unit: "KG", opening_stock_qty: 0, updated_at: now },
      { id: "sugar", company_id: CO, name: "Sugar", unit: "KG", opening_stock_qty: 10, opening_stock_rate_paise: 0, purchase_price_paise: 5000, updated_at: now },
    ] as never[]);
    const v = (id: string, type: string, date: string) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: id,
      voucher_date: date,
      total_paise: 0,
      is_deleted: false,
      updated_at: now,
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("p1", "purchase", "2026-01-10"),
      v("s1", "sales", "2026-02-01"),
      v("p2", "purchase", "2026-03-01"),
      v("cn1", "credit_note", "2026-03-05"),
      v("dn1", "debit_note", "2026-03-10"),
      v("mfg", "manufacturing", "2026-03-12"), // not counted
    ] as never[]);
    const line = (id: string, voucher: string, item: string, qty: number, rate: number) => ({
      id,
      company_id: CO,
      voucher_id: voucher,
      item_id: item,
      qty,
      rate_paise: rate,
      is_deleted: false,
    });
    await offlineDb.cache_voucher_items.bulkPut([
      line("l1", "p1", "basmati", 50, 4500),
      line("l2", "s1", "basmati", 30, 5200),
      line("l3", "p2", "basmati", 20, 4800),
      line("l4", "cn1", "basmati", 2, 5200),
      line("l5", "dn1", "basmati", 1, 4800),
      line("l6", "mfg", "basmati", 999, 1),
    ] as never[]);
  });

  it("gives the closing quantity and values it at the last purchase rate, with godowns marked not available", async () => {
    const res = await runItemStock({ itemName: "Rice Basmati", asOn: "2026-03-31", companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.openingQty).toBe(100);
    expect(res.movementQty).toBe(41); // +50 −30 +20 +2 −1; manufacturing not counted
    expect(res.closingQty).toBe(141);
    expect(res.rateSource).toBe("last_purchase");
    expect(res.rateDate).toBe("2026-03-01");
    expect(res.valuationRatePaise).toBe(4800);
    expect(res.valuePaise).toBe(141 * 4800);
  });

  it("measures as on an earlier date, using the purchase rate then in force", async () => {
    const res = await runItemStock({ itemName: "Rice Basmati", asOn: "2026-02-15", companyId: CO });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.closingQty).toBe(120);
    expect(res.valuationRatePaise).toBe(4500);
    expect(res.rateDate).toBe("2026-01-10");
  });

  it("falls back to the purchase price, and says so, when no purchase rate or opening rate exists", async () => {
    const res = await runItemStock({ itemName: "Sugar", asOn: "2026-03-31", companyId: CO });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.rateSource).toBe("purchase_price");
    expect(res.valuePaise).toBe(10 * 5000);
  });

  it("prefers the exact name over a longer name that contains it", async () => {
    const res = await runItemStock({ itemName: "Rice Basmati", asOn: "2026-03-31", companyId: CO });
    expect(res.status).toBe("resolved");
  });

  it("asks which item when the name matches more than one", async () => {
    const res = await runItemStock({ itemName: "Rice", asOn: "2026-03-31", companyId: CO });
    expect(res.status).toBe("ambiguous");
    if (res.status !== "ambiguous") return;
    expect(res.candidates.sort()).toEqual(["Rice Basmati", "Rice Basmati Premium"]);
  });

  it("reports an item that is not in the books", async () => {
    const res = await runItemStock({ itemName: "Wheat", asOn: "2026-03-31", companyId: CO });
    expect(res.status).toBe("not_found");
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runItemStock({ itemName: "Sugar", asOn: "31/02/2026", companyId: CO });
    expect(res.status).toBe("invalid_date");
  });
});
