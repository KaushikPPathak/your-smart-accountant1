import { describe, expect, it } from "vitest";
import { chronologicalLedgerRows, type LedgerPdfTransaction } from "@/lib/ledger-pdf-document";

const transaction = (id: string, date: string, debitPaise: number, creditPaise: number): LedgerPdfTransaction => ({
  id, date, debitPaise, creditPaise, particulars: "", voucherType: "journal", voucherNumber: id, reference: "",
});

describe("WhatsApp ledger date sequence", () => {
  it("interleaves debit and credit entries chronologically rather than separating sides", () => {
    const rows = chronologicalLedgerRows([
      transaction("11", "2025-10-28", 3800000, 0),
      transaction("14", "2025-07-17", 0, 13779080),
      transaction("15", "2025-07-22", 0, 2050000),
    ], -14807074);
    expect(rows.map(row => row.date)).toEqual(["2025-07-17", "2025-07-22", "2025-10-28"]);
    expect(rows.map(row => row.balancePaise)).toEqual([-28586154, -30636154, -26836154]);
  });
  it("keeps same-date voucher order deterministic across page boundaries", () => {
    const rows = chronologicalLedgerRows([
      transaction("7", "2026-03-31", 37128067, 0),
      transaction("2", "2026-03-31", 3219712, 0),
      transaction("3", "2026-03-31", 155694, 0),
    ], 0);
    expect(rows.map(row => row.voucherNumber)).toEqual(["2", "3", "7"]);
    expect(rows.at(-1)?.balancePaise).toBe(40503473);
  });
});