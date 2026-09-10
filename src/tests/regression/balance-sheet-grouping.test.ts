import { describe, expect, it } from "vitest";
import { groupBalances, groupedTRows } from "@/lib/report-grouping";
import type { LedgerBalance } from "@/lib/reports";

describe("Balance Sheet grouping preserves sign-switched balances", () => {
  it("keeps a bank overdraft on liabilities", () => {
    const rows: LedgerBalance[] = [{
      id: "bank-od",
      name: "Bank OD",
      type: "bank",
      group_code: "BANK_ACCOUNTS",
      closing_paise: -104_672_09,
    }];

    const buckets = groupBalances(rows, "BS_LIAB", (row) => -row.closing_paise);
    expect(buckets[0]?.group.code).toBe("BANK_OVERDRAFT");
    expect(groupedTRows(buckets).totalPaise).toBe(104_672_09);
  });

  it("keeps debit tax balances and debit creditors on assets", () => {
    const rows: LedgerBalance[] = [
      {
        id: "tax-credit",
        name: "GST Input Credit",
        type: "duties_taxes",
        group_code: "DUTIES_AND_TAXES",
        closing_paise: 7_989_00,
      },
      {
        id: "supplier-advance",
        name: "Supplier Advance",
        type: "sundry_creditor",
        group_code: "SUNDRY_CREDITORS",
        closing_paise: 12_000_00,
      },
    ];

    const buckets = groupBalances(rows, "BS_ASSET", (row) => row.closing_paise);
    expect(buckets.flatMap((bucket) => bucket.rows).map((row) => row.id)).toEqual([
      "supplier-advance",
      "tax-credit",
    ]);
    expect(groupedTRows(buckets).totalPaise).toBe(19_989_00);
  });
});