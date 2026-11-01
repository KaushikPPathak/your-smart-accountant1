import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { saveManufacturingLocal, type ManufacturingSnapInput } from "@/lib/offline/manufacturing-local";

const CO = "mfg-co";

const snap = (over: Partial<ManufacturingSnapInput> = {}): ManufacturingSnapInput => ({
  companyId: CO,
  date: "2026-06-15",
  department: "",
  productionOrderNo: "PO-7",
  composedNarration: "test run",
  consume: [{ item_id: "RAW", qty: "10", rate: "100", attrs: [] }],
  outputs: [{ item_id: "FG", qty: "5", rate: "250", attrs: [] }],
  totalConsumePaise: 100000,
  processingPaise: 20000,
  scrapPaise: 5000,
  headerMeta: { production_order_no: "PO-7" },
  ...over,
});

describe("saveManufacturingLocal", () => {
  beforeEach(async () => {
    await Promise.all([
      db.cache_companies.clear(),
      db.cache_vouchers.clear(),
      db.cache_voucher_items.clear(),
      db.cache_voucher_entries.clear(),
      db.cache_ledgers.clear(),
    ]);
    await db.cache_companies.put({ id: CO, company_id: CO, name: "Mfg", financial_year_start: "2026-04-01" });
  });

  it("writes the voucher, item lines and balanced ledger entries", async () => {
    const res = await saveManufacturingLocal(snap());

    const v: any = await db.cache_vouchers.get(res.voucherId);
    expect(v).toMatchObject({ voucher_type: "manufacturing", voucher_date: "2026-06-15", total_paise: 115000 });

    const items = await db.cache_voucher_items.where("voucher_id").equals(res.voucherId).toArray();
    expect(items.sort((a: any, b: any) => a.line_no - b.line_no).map((i: any) => [i.item_id, i.qty])).toEqual([["RAW", -10], ["FG", 5]]);

    const entries = await db.cache_voucher_entries.where("voucher_id").equals(res.voucherId).toArray();
    const dr = entries.reduce((s: number, e: any) => s + e.debit_paise, 0);
    const cr = entries.reduce((s: number, e: any) => s + e.credit_paise, 0);
    expect(entries).toHaveLength(4);
    expect(dr).toBe(cr);
  });

  it("reuses an existing Finished Goods ledger instead of creating a second one", async () => {
    await db.cache_ledgers.put({ id: "FG-L", company_id: CO, name: "finished goods", type: "stock_in_hand", is_active: true });
    await saveManufacturingLocal(snap());
    await saveManufacturingLocal(snap({ date: "2026-06-16" }));

    const fg = (await db.cache_ledgers.where("company_id").equals(CO).toArray()).filter(
      (l: any) => String(l.name).toLowerCase() === "finished goods",
    );
    expect(fg).toHaveLength(1);
    expect(fg[0].id).toBe("FG-L");
  });
});
