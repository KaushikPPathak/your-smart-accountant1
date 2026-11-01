import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { runMaintenanceLocal } from "@/lib/offline/maintenance-local";

const CO = "mx-co";

describe("runMaintenanceLocal", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_vouchers.clear(), db.cache_voucher_entries.clear(), db.cache_ledgers.clear()]);
    await db.cache_vouchers.bulkPut([
      { id: "OK", company_id: CO, voucher_number: "S/1", voucher_type: "sales", voucher_date: "2026-04-01" },
      { id: "BAD", company_id: CO, voucher_number: "S/2", voucher_type: "sales", voucher_date: "2026-04-02" },
      { id: "EMPTY", company_id: CO, voucher_number: "S/3", voucher_type: "sales", voucher_date: "2026-04-03" },
      { id: "DEL", company_id: CO, voucher_number: "S/4", voucher_type: "sales", voucher_date: "2026-04-04", is_deleted: true },
      { id: "DUP", company_id: CO, voucher_number: "P/1", voucher_type: "purchase", voucher_date: "2026-04-05" },
      { id: "DUP2", company_id: CO, voucher_number: "P/1", voucher_type: "purchase", voucher_date: "2026-04-06" },
    ]);
    await db.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "OK", company_id: CO, ledger_id: "L1", debit_paise: 100, credit_paise: 0 },
      { id: "e2", voucher_id: "OK", company_id: CO, ledger_id: "L2", debit_paise: 0, credit_paise: 100 },
      { id: "e3", voucher_id: "BAD", company_id: CO, ledger_id: "L1", debit_paise: 500, credit_paise: 0 },
      { id: "e4", voucher_id: "BAD", company_id: CO, ledger_id: "L2", debit_paise: 0, credit_paise: 400 },
      { id: "e5", voucher_id: "GONE", company_id: CO, ledger_id: "L1", debit_paise: 50, credit_paise: 0 },
      { id: "e6", voucher_id: "DEL", company_id: CO, ledger_id: "L1", debit_paise: 70, credit_paise: 0 },
    ]);
  });

  it("flags unbalanced vouchers and passes balanced ones", async () => {
    const r = await runMaintenanceLocal(CO);
    expect(r.integrity.checkedVouchers).toBe(5);
    expect(r.integrity.unbalanced.map((u) => u.id)).toContain("BAD");
    expect(r.integrity.unbalanced.map((u) => u.id)).not.toContain("OK");
    expect(r.integrity.unbalanced.find((u) => u.id === "BAD")?.diff).toBe(100);
  });

  it("counts lines whose voucher does not exist as orphans", async () => {
    const r = await runMaintenanceLocal(CO);
    expect(r.integrity.orphanEntries).toBe(1);
  });

  it("reports lines left on a deleted voucher separately from orphans", async () => {
    const r = await runMaintenanceLocal(CO);
    expect(r.integrity.linesOnDeletedVouchers).toBe(1);
  });

  it("reports live vouchers with no posting lines", async () => {
    const r = await runMaintenanceLocal(CO);
    expect(r.integrity.emptyVouchers).toBe(3);
  });

  it("finds a voucher number used twice within one type", async () => {
    const r = await runMaintenanceLocal(CO);
    const purchase = r.numbering.find((n) => n.voucherType === "purchase");
    expect(purchase?.duplicates).toEqual(["P/1"]);
    const check = r.checks.find((c) => c.key === "numbering");
    expect(check?.status).toBe("error");
  });

  it("reports a missing company without touching any books", async () => {
    const r = await runMaintenanceLocal(null);
    expect(r.integrity.checkedVouchers).toBe(0);
    expect(r.checks.find((c) => c.key === "company")?.status).toBe("error");
  });
});
