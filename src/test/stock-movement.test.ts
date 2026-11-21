import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runStockMovement } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 5.2: fast, normal, slow and dead stock as on 31 Mar 2026.
const CO = "co-movement";
const ASOF = "2026-03-31";

describe("routing: stock movement", () => {
  it("routes the questionnaire wording to stock_movement", () => {
    expect(routeQuery("Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)?").intent).toBe(
      "stock_movement",
    );
  });

  it("keeps the item stock question on item_stock", () => {
    expect(routeQuery("What is the current stock quantity and valuation for Rice Basmati across all godowns?").intent).toBe("item_stock");
  });
});

describe("stock movement classes", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_items.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_items.clear(),
    ]);
    const now = new Date().toISOString();
    const item = (id: string, name: string, opening: number) => ({
      id,
      company_id: CO,
      name,
      unit: "KG",
      opening_stock_qty: opening,
      updated_at: now,
    });
    await offlineDb.cache_items.bulkPut([
      item("basmati", "Rice Basmati", 100), // fast: three movements in March
      item("sugar", "Sugar", 10), // slow: last moved 15 Jan (75 days)
      item("dal", "Dal", 5), // dead: last moved 1 Nov 2025
      item("wheat", "Wheat", 20), // dead: no movement at all
      item("mustard", "Mustard", 10), // normal: one movement, 11 days ago
      item("salt", "Salt", 0), // not on hand: skipped
      item("oil", "Oil", 0), // bought and sold out: closing zero, skipped
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
      v("p-b1", "purchase", "2026-03-01"),
      v("s-b1", "sales", "2026-03-10"),
      v("p-b2", "purchase", "2026-03-20"),
      v("s-su", "sales", "2026-01-15"),
      v("s-da", "sales", "2025-11-01"),
      v("p-mu", "purchase", "2026-03-20"),
      v("p-oil", "purchase", "2026-03-25"),
      v("s-oil", "sales", "2026-03-26"),
    ] as never[]);
    const line = (id: string, voucher: string, itemId: string, qty: number) => ({
      id,
      company_id: CO,
      voucher_id: voucher,
      item_id: itemId,
      qty,
      rate_paise: 1000,
      is_deleted: false,
    });
    await offlineDb.cache_voucher_items.bulkPut([
      line("l1", "p-b1", "basmati", 10),
      line("l2", "s-b1", "basmati", 5),
      line("l3", "p-b2", "basmati", 10),
      line("l4", "s-su", "sugar", 2),
      line("l5", "s-da", "dal", 1),
      line("l6", "p-mu", "mustard", 4),
      line("l7", "p-oil", "oil", 10),
      line("l8", "s-oil", "oil", 10),
    ] as never[]);
  });

  it("classifies each item on hand by its recent and last movement", async () => {
    const res = await runStockMovement({ companyId: CO, asOn: ASOF });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    const cls = Object.fromEntries(res.rows.map((r) => [r.item, r.classification]));
    expect(cls).toEqual({
      "Rice Basmati": "fast",
      Sugar: "slow",
      Dal: "dead",
      Wheat: "dead",
      Mustard: "normal",
    });
  });

  it("skips items with nothing on hand, and reports the days since last movement", async () => {
    const res = await runStockMovement({ companyId: CO, asOn: ASOF });
    if (res.status !== "resolved") throw new Error("not resolved");
    expect(res.counted).toBe(5);
    const byItem = Object.fromEntries(res.rows.map((r) => [r.item, r]));
    expect(byItem.Sugar.daysSinceMovement).toBe(75);
    expect(byItem.Dal.daysSinceMovement).toBe(150);
    expect(byItem.Wheat.lastMovementDate).toBeNull();
    expect(byItem["Rice Basmati"].movementsLast30).toBe(3);
    expect(byItem["Rice Basmati"].closingQty).toBe(115);
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runStockMovement({ companyId: CO, asOn: "31/02/2026" });
    expect(res.status).toBe("invalid_date");
  });
});
