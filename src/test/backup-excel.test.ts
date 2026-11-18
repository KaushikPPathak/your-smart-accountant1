import { describe, expect, it } from "vitest";
import { buildBackupWorkbook } from "@/lib/backup-excel";
import type { CompanyBackup } from "@/lib/backup";

function sample(): CompanyBackup {
  return {
    schema_version: 2,
    exported_at: "2026-11-18T00:00:00.000Z",
    company: { name: "Test Co" },
    settings: null,
    ledgers: [{ id: "l1", name: "Cash", opening_balance_paise: 100 }],
    items: [],
    vouchers: [{ id: "v1", voucher_number: "1", total_paise: 500 }],
    voucher_items: [],
    voucher_entries: [{ id: "e1", debit_paise: 500, credit_paise: 0 }],
    bill_allocations: [],
    recurring_invoices: [],
  };
}

describe("backup Excel companion", () => {
  it("builds an xlsx (zip) without changing the backup payload", async () => {
    const backup = sample();
    const before = JSON.stringify(backup);
    const buf = await buildBackupWorkbook(backup);
    const bytes = new Uint8Array(buf);
    // xlsx files are zip archives: they start with "PK"
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(JSON.stringify(backup)).toBe(before);
  });
});
