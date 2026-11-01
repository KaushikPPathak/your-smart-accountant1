import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { localDashboardInputs } from "@/routes/app.index";

const CO = "dash-co";

describe("dashboard local inputs", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_vouchers.clear(), db.cache_ledgers.clear(), db.cache_items.clear()]);
    await db.cache_ledgers.put({ id: "C1", company_id: CO, name: "Ravi Traders", type: "sundry_debtor", is_active: true });
    await db.cache_vouchers.bulkPut([
      { id: "S1", company_id: CO, voucher_type: "sales", voucher_number: "S/1", voucher_date: "2026-10-05", total_paise: 100000, party_ledger_id: "C1", cgst_paise: 9000, sgst_paise: 9000, igst_paise: 0 },
      { id: "S2", company_id: CO, voucher_type: "sales", voucher_number: "S/2", voucher_date: "2026-10-06", total_paise: 50000, party_ledger_id: null, cgst_paise: 0, sgst_paise: 0, igst_paise: 0 },
      { id: "S3", company_id: CO, voucher_type: "sales", voucher_number: "S/3", voucher_date: "2026-10-07", total_paise: 70000, party_ledger_id: "C1", deleted_at: "2026-10-08", cgst_paise: 0, sgst_paise: 0, igst_paise: 0 },
      { id: "P1", company_id: CO, voucher_type: "purchase", voucher_number: "P/1", voucher_date: "2026-05-01", total_paise: 30000, party_ledger_id: null, cgst_paise: 0, sgst_paise: 0, igst_paise: 0 },
    ]);
  });

  it("sums this month's sales, skipping deleted vouchers, and lists the newest first", async () => {
    const [sales, recent, six, gst] = await localDashboardInputs(CO, "2026-10-01", "2026-10-31", "2026-05-01");
    expect((sales.data as any[]).reduce((s, r) => s + r.total_paise, 0)).toBe(150000);
    expect((recent.data as any[])[0].voucher_number).toBe("S/2");
    expect((six.data as any[]).map((r) => r.voucher_type).sort()).toEqual(["purchase", "sales", "sales"]);
    const tax = (gst.data as any[]).reduce((s, r) => s + r.cgst_paise + r.sgst_paise + r.igst_paise, 0);
    expect(tax).toBe(18000);
  });
});
