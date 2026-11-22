import { describe, expect, it } from "vitest";
import { financialYearOf, findDuplicateInvoice, normalizeInvoiceNumber, type InvoiceRow } from "@/lib/invoice-uniqueness";

const row = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: "x", voucher_type: "sales", voucher_date: "2026-05-10", voucher_number: "1", reference_no: null, party_ledger_id: "p1", is_deleted: false, ...over,
});

describe("normalisation", () => {
  it("ignores case, spaces and leading zeros, keeps separators", () => {
    expect(normalizeInvoiceNumber(" inv / 25-26 / 001 ")).toBe("INV/25-26/1");
    expect(normalizeInvoiceNumber("INV/2/11")).not.toBe(normalizeInvoiceNumber("INV/21/1"));
  });
});

describe("financial year", () => {
  it("April 1 starts a year; March 31 ends the previous one", () => {
    expect(financialYearOf("2026-03-31")).toBe("2025-26");
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
  });
});

describe("sales invoice numbers", () => {
  it("flags the same number in the same financial year and type", () => {
    const existing = [row({ voucher_number: "INV-007" })];
    const hits = findDuplicateInvoice({ voucherType: "sales", voucherDate: "2026-06-01", number: "inv-7" }, existing);
    expect(hits).toHaveLength(1);
  });

  it("allows the same number in the next financial year", () => {
    const existing = [row({ voucher_number: "INV-7", voucher_date: "2025-06-01" })];
    expect(findDuplicateInvoice({ voucherType: "sales", voucherDate: "2026-06-01", number: "INV-7" }, existing)).toHaveLength(0);
  });

  it("does not compare against the voucher being edited, or deleted ones", () => {
    const existing = [row({ id: "same", voucher_number: "A1" }), row({ id: "gone", voucher_number: "A1", is_deleted: true })];
    expect(findDuplicateInvoice({ voucherId: "same", voucherType: "sales", voucherDate: "2026-06-01", number: "A1" }, existing)).toHaveLength(0);
  });
});

describe("supplier bill numbers", () => {
  it("flags a repeated bill from the same supplier in the same year", () => {
    const existing = [row({ voucher_type: "purchase", reference_no: "BILL-45", voucher_number: "PUR-1" })];
    const hits = findDuplicateInvoice({ voucherType: "purchase", voucherDate: "2026-07-01", number: "bill-045", partyId: "p1" }, existing);
    expect(hits).toHaveLength(1);
  });

  it("does not flag the same bill number from a different supplier", () => {
    const existing = [row({ voucher_type: "purchase", reference_no: "BILL-45", party_ledger_id: "p2" })];
    expect(findDuplicateInvoice({ voucherType: "purchase", voucherDate: "2026-07-01", number: "BILL-45", partyId: "p1" }, existing)).toHaveLength(0);
  });

  it("ignores an empty number", () => {
    const existing = [row({ voucher_type: "purchase", reference_no: "" })];
    expect(findDuplicateInvoice({ voucherType: "purchase", voucherDate: "2026-07-01", number: "  ", partyId: "p1" }, existing)).toHaveLength(0);
  });
});

describe("duplicate groups for the audit", () => {
  it("groups repeated supplier bills, reading vendor_invoice_no or reference_no", async () => {
    const { duplicateInvoiceGroups, supplierBillNumber } = await import("@/lib/invoice-uniqueness");
    const rows: InvoiceRow[] = [
      row({ id: "a", voucher_type: "purchase", voucher_number: "PUR-1", vendor_invoice_no: "BILL-9", party_ledger_id: "p1" }),
      row({ id: "b", voucher_type: "purchase", voucher_number: "PUR-2", reference_no: "bill-009", party_ledger_id: "p1" }),
      row({ id: "c", voucher_type: "purchase", voucher_number: "PUR-3", reference_no: "BILL-9", party_ledger_id: "p2" }),
    ];
    expect(supplierBillNumber(rows[1])).toBe("bill-009");
    const groups = duplicateInvoiceGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("groups repeated sales invoice numbers in the same year only", async () => {
    const { duplicateInvoiceGroups } = await import("@/lib/invoice-uniqueness");
    const rows: InvoiceRow[] = [
      row({ id: "s1", voucher_type: "sales", voucher_number: "INV-5", voucher_date: "2026-05-01" }),
      row({ id: "s2", voucher_type: "sales", voucher_number: "INV-05", voucher_date: "2026-08-01" }),
      row({ id: "s3", voucher_type: "sales", voucher_number: "INV-5", voucher_date: "2027-05-01" }),
    ];
    const groups = duplicateInvoiceGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((v) => v.id).sort()).toEqual(["s1", "s2"]);
  });
});
