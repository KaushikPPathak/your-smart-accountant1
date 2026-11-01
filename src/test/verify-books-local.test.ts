import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { verifyBooksLocal } from "@/lib/offline/verify-books-local";

const CO = "vb-co";

describe("verifyBooksLocal", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_vouchers.clear(), db.cache_voucher_entries.clear()]);
    await db.cache_vouchers.bulkPut([
      { id: "OK", company_id: CO, voucher_number: "S/1", voucher_type: "sales", voucher_date: "2026-04-01" },
      { id: "BAD", company_id: CO, voucher_number: "S/2", voucher_type: "sales", voucher_date: "2026-04-02" },
      { id: "EMPTY", company_id: CO, voucher_number: "S/3", voucher_type: "sales", voucher_date: "2026-04-03" },
      { id: "DEL", company_id: CO, voucher_number: "S/4", voucher_type: "sales", voucher_date: "2026-04-04", is_deleted: true },
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
    const r = await verifyBooksLocal(CO);
    expect(r.checkedVouchers).toBe(3);
    expect(r.unbalanced.map((u) => u.id)).toEqual(["BAD"]);
    expect(r.unbalanced[0].diff).toBe(100);
  });

  it("counts lines whose voucher does not exist as orphans", async () => {
    const r = await verifyBooksLocal(CO);
    expect(r.orphanEntries).toBe(1);
  });

  it("reports lines left on a deleted voucher separately from orphans", async () => {
    const r = await verifyBooksLocal(CO);
    expect(r.linesOnDeletedVouchers).toBe(1);
  });

  it("reports live vouchers with no posting lines", async () => {
    const r = await verifyBooksLocal(CO);
    expect(r.emptyVouchers).toBe(1);
  });
});
