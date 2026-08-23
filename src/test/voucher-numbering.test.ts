import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULE,
  formatVoucherNumber,
  fyToken,
  nextVoucherNumberFor,
  type NumberingRule,
} from "@/lib/voucher-numbering";

const rule = (extra: Partial<NumberingRule> = {}): NumberingRule => ({ ...DEFAULT_RULE, ...extra });

describe("voucher numbering", () => {
  it("plain serial by default", () => {
    expect(formatVoucherNumber(rule(), { seq: 7, date: "2026-05-01" })).toBe("7");
  });
  it("pads and prefixes", () => {
    expect(formatVoucherNumber(rule({ prefix: "INV", separator: "-", width: 4 }), { seq: 7, date: "2026-05-01" }))
      .toBe("INV-0007");
  });
  it("FY token follows Indian April-March year", () => {
    expect(fyToken("2026-05-01")).toBe("26-27");
    expect(fyToken("2026-03-31")).toBe("25-26");
  });
  it("composes prefix / FY / month / serial", () => {
    const r = rule({ prefix: "SI", includeFy: true, includeMonth: true, width: 3 });
    expect(formatVoucherNumber(r, { seq: 12, date: "2026-04-10" })).toBe("SI/26-27/04/012");
  });
  it("continues from the highest existing serial", () => {
    const r = rule({ prefix: "INV", separator: "-", width: 4 });
    expect(nextVoucherNumberFor(r, [
      { voucher_number: "INV-0004", voucher_date: "2026-05-01" },
      { voucher_number: "INV-0011", voucher_date: "2026-05-02" },
    ], "2026-05-03")).toBe("INV-0012");
  });
  it("restarts each financial year when configured", () => {
    const r = rule({ includeFy: true, reset: "yearly", width: 3, prefix: "INV" });
    expect(nextVoucherNumberFor(r, [
      { voucher_number: "INV/25-26/044", voucher_date: "2026-03-30" },
    ], "2026-04-01")).toBe("INV/26-27/001");
  });
  it("restarts monthly when configured", () => {
    const r = rule({ includeFy: true, includeMonth: true, reset: "monthly", width: 3 });
    expect(nextVoucherNumberFor(r, [
      { voucher_number: "26-27/04/009", voucher_date: "2026-04-28" },
    ], "2026-05-02")).toBe("26-27/05/001");
  });
  it("honours the configured start number", () => {
    expect(nextVoucherNumberFor(rule({ start: 501 }), [], "2026-05-01")).toBe("501");
  });
});
