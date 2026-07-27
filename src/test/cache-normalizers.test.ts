import { describe, expect, it } from "vitest";
import { normalizeLedger } from "@/lib/offline/cache-normalizers";

describe("legacy ledger cache normalization", () => {
  it("restores required edit fields for an older party ledger", () => {
    const row = normalizeLedger({
      id: "legacy-party",
      company_id: "zaveri-and-co",
      name: "Zaveri And Co",
      group_name: "Sundry Debtors",
      gstin: "24AAAAA0000A1Z5",
    });

    expect(row?.type).toBe("sundry_debtor");
    expect(row?.group_code).toBe("SUNDRY_DEBTORS");
    expect(row?.opening_balance_paise).toBe(0);
    expect(row?.opening_balance_is_debit).toBe(true);
    expect(row?.credit_limit_paise).toBe(0);
    expect(row?.credit_days).toBe(0);
  });

  it("keeps an existing valid classification and credit opening side", () => {
    const row = normalizeLedger({
      id: "legacy-supplier",
      name: "Supplier",
      type: "sundry_creditor",
      group_code: "SUNDRY_CREDITORS",
      opening_balance_is_debit: false,
    });

    expect(row?.type).toBe("sundry_creditor");
    expect(row?.group_code).toBe("SUNDRY_CREDITORS");
    expect(row?.opening_balance_is_debit).toBe(false);
  });
});