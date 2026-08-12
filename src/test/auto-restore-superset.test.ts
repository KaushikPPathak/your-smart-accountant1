import { describe, expect, it } from "vitest";
import { isBackupSafeSuperset } from "@/lib/auto-restore";
import type { CompanyBackup } from "@/lib/backup";

function backup(voucherNumbers: string[], ledgerNames = ["Cash", "Sales"]): CompanyBackup {
  return {
    schema_version: 1,
    exported_at: "2026-07-19T00:00:00.000Z",
    company: { id: "source", name: "Shri Montu Ramanath Das" },
    settings: null,
    ledgers: ledgerNames.map((name, index) => ({ id: `l${index}`, name })),
    items: [],
    vouchers: voucherNumbers.map((number) => ({
      id: `v${number}`,
      voucher_date: `2026-02-${number.padStart(2, "0")}`,
      voucher_type: "receipt",
      voucher_number: number,
      total_amount: 100,
    })),
    voucher_items: [],
    voucher_entries: [],
    bill_allocations: [],
    recurring_invoices: [],
  };
}

describe("automatic restore superset guard", () => {
  it("accepts a fuller snapshot containing every live voucher", () => {
    expect(isBackupSafeSuperset(backup(["1", "2", "3"]), backup(["1", "2"]))).toBe(true);
  });

  it("rejects an older divergent snapshot that would remove newer work", () => {
    expect(isBackupSafeSuperset(backup(["1", "2", "3"]), backup(["1", "4"]))).toBe(false);
  });

  it("rejects a snapshot missing a newly-created ledger", () => {
    expect(
      isBackupSafeSuperset(
        backup(["1", "2", "3"]),
        backup(["1", "2"], ["Cash", "Sales", "New Bank"]),
      ),
    ).toBe(false);
  });
});