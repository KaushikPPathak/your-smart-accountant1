import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runVendorConcentration } from "@/lib/ai/accounting-query-engine";
import { offlineDb } from "@/lib/offline/db";

// Questionnaire 3.5: vendors that make up 80% of purchase spend. Paise throughout.
const CO = "co-conc";

describe("routing: vendor concentration", () => {
  it("routes the questionnaire wording to vendor_concentration", () => {
    expect(routeQuery("Which vendors account for 80% of our purchase spend this year?").intent).toBe("vendor_concentration");
  });

  it("keeps the vendor overdue question on its own intent", () => {
    expect(routeQuery("Which vendors have overdue balances or unadjusted debit notes/advances?").intent).toBe("vendor_overdue");
  });
});

describe("vendor concentration ranking", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([offlineDb.cache_ledgers.clear(), offlineDb.cache_vouchers.clear()]);
    const now = new Date().toISOString();
    const vendor = (id: string, name: string) => ({
      id,
      company_id: CO,
      name,
      group_name: "Sundry Creditors",
      opening_balance_paise: 0,
      opening_balance_is_debit: false,
      updated_at: now,
    });
    await offlineDb.cache_ledgers.bulkPut([
      vendor("kumar", "Kumar Supplies"),
      vendor("rao", "Rao Trading"),
      vendor("tara", "Tara Agro"),
      vendor("om", "Om Traders"),
    ] as never[]);
    const v = (id: string, type: string, date: string, party: string, total: number) => ({
      id,
      company_id: CO,
      voucher_type: type,
      voucher_number: id,
      voucher_date: date,
      party_ledger_id: party,
      total_paise: total,
      is_deleted: false,
      updated_at: now,
    });
    await offlineDb.cache_vouchers.bulkPut([
      v("p1", "purchase", "2026-01-10", "kumar", 500_000),
      v("p2", "purchase", "2026-02-10", "rao", 300_000),
      v("p3", "purchase", "2026-03-10", "tara", 150_000),
      v("p4", "purchase", "2026-04-02", "om", 50_000),
      v("dn1", "debit_note", "2026-04-05", "kumar", 100_000), // returns are not deducted from spend
      v("pay1", "payment", "2026-04-06", "tara", 999_999), // payments are not spend
      v("p5", "purchase", "2025-06-01", "tara", 400_000), // before the period below
    ] as never[]);
  });

  it("lists vendors largest first until the cumulative share reaches 80%, including the vendor that crosses it", async () => {
    const res = await runVendorConcentration({ companyId: CO });
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    // All-time purchases: Tara 550,000 (incl. the 2025 bill), Kumar 500,000, Rao 300,000, Om 50,000. Total 1,400,000.
    // Returns and payments are excluded. Cumulative: Tara 39.3%, + Kumar 75.0%, + Rao 96.4% (crosses 80%, included).
    expect(res.totalPaise).toBe(1_400_000);
    expect(res.vendorCount).toBe(4);
    expect(res.rows.map((r) => r.vendor)).toEqual(["Tara Agro", "Kumar Supplies", "Rao Trading"]);
    expect(res.rows.map((r) => r.cumulativePct)).toEqual([39.3, 75, 96.4]);
    expect(res.reachedThreshold).toBe(true);
  });

  it("counts only purchases in the period when dates are given", async () => {
    const res = await runVendorConcentration({ companyId: CO, from: "2026-01-01", to: "2026-04-30" });
    if (res.status !== "resolved") throw new Error("not resolved");
    // Jan–Apr 2026: Kumar 500,000 (50%), Rao 300,000 (cumulative 80%, the cut-off). Tara and Om are not listed.
    expect(res.totalPaise).toBe(1_000_000);
    expect(res.rows.map((r) => r.vendor)).toEqual(["Kumar Supplies", "Rao Trading"]);
    expect(res.rows.map((r) => r.cumulativePct)).toEqual([50, 80]);
  });

  it("reports an invalid date instead of guessing", async () => {
    const res = await runVendorConcentration({ companyId: CO, from: "31/02/2026" });
    expect(res.status).toBe("invalid_date");
  });
});
