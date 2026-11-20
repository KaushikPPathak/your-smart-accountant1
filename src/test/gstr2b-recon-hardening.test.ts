import { describe, expect, it } from "vitest";
import { parseAnyDate, reconcile, toPaise, DEFAULT_TOLERANCES, type BookPurchase, type ParsedRow } from "@/lib/gstr2b-recon";

describe("GSTR-2B amounts are read exactly or refused", () => {
  it("reads ordinary amounts, Indian grouping, brackets and dashes", () => {
    expect(toPaise("1,20,000.50")).toBe(12000050);
    expect(toPaise("(100)")).toBe(-10000);
    expect(toPaise("-")).toBe(0);
    expect(toPaise("")).toBe(0);
    expect(toPaise(null)).toBe(0);
    expect(toPaise(1.5)).toBe(150);
  });

  it("throws on malformed amounts instead of reading a different number", () => {
    expect(() => toPaise("1.2.3")).toThrow(/Invalid amount/);
    expect(() => toPaise("12-3")).toThrow(/Invalid amount/);
    expect(() => toPaise(Number.NaN)).toThrow(/Invalid amount/);
  });
});

describe("GSTR-2B dates must be real calendar dates", () => {
  it("accepts real dates in the common shapes", () => {
    expect(parseAnyDate("28/02/2026")).toBe("2026-02-28");
    expect(parseAnyDate("2026-03-31")).toBe("2026-03-31");
    expect(parseAnyDate("01-Apr-2026")).toBe("2026-04-01");
  });

  it("rejects days that do not exist, rather than rolling them over", () => {
    expect(parseAnyDate("31/02/2026")).toBeNull();
    expect(parseAnyDate("2026-02-31")).toBeNull();
    expect(parseAnyDate("31-Apr-2026")).toBeNull();
  });
});

describe("GSTR-2B tax heads are compared, not only the invoice total", () => {
  const tol = { ...DEFAULT_TOLERANCES };
  const row = (over: Partial<ParsedRow> = {}): ParsedRow => ({
    supplier_gstin: "24ABCDE1234F1Z5",
    supplier_name: "Supplier",
    invoice_no: "INV-1",
    invoice_date: "2026-04-10",
    invoice_value_paise: 118000,
    taxable_paise: 100000,
    igst_paise: 0,
    cgst_paise: 9000,
    sgst_paise: 9000,
    ...over,
  });
  const book = (over: Partial<BookPurchase> = {}): BookPurchase => ({
    id: "b1",
    voucher_number: "P-1",
    voucher_date: "2026-04-10",
    total_paise: 118000,
    vendor_invoice_no: "INV-1",
    ledgers: { name: "Supplier", gstin: "24ABCDE1234F1Z5" },
    cgst_paise: 9000,
    sgst_paise: 9000,
    igst_paise: 0,
    ...over,
  });

  it("matches when the tax heads agree", () => {
    const [r] = reconcile([row()], [book()], tol);
    expect(r.match_status).toBe("matched");
  });

  it("flags a CGST/SGST split that differs even when the invoice total is the same", () => {
    // Same total (1,180.00), but the books have CGST 8,000 + IGST 1,000 instead of CGST/SGST 9,000 each.
    const [r] = reconcile([row()], [book({ cgst_paise: 8000, sgst_paise: 0, igst_paise: 1000 })], tol);
    expect(r.match_status).toBe("tax_mismatch");
  });

  it("allows a difference within the per-head tolerance", () => {
    const [r] = reconcile([row()], [book({ cgst_paise: 9050, sgst_paise: 9000 })], tol);
    expect(r.match_status).not.toBe("tax_mismatch");
  });
});
