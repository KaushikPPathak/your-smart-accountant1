import { describe, expect, it } from "vitest";
import {
  createGstr9InputId,
  emptyTaxAmount,
  emptyTaxPaid,
  getGstr9InputStatus,
  totalGstrNonTaxPayment,
  totalGstrTaxPaid,
  type Gstr9InputRecord,
} from "./gstr9-inputs";

describe("gstr9-inputs", () => {
  it("creates zero-value tax structures", () => {
    expect(emptyTaxAmount()).toEqual({ taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(emptyTaxPaid()).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0, interest: 0, lateFee: 0, penalty: 0, others: 0 });
  });

  it("returns INPUT_REQUIRED when a source has not been entered", () => {
    expect(getGstr9InputStatus(null)).toEqual({ gstr1: "INPUT_REQUIRED", gstr3b: "INPUT_REQUIRED", gstr2b: "INPUT_REQUIRED", itcTables: "INPUT_REQUIRED", taxPayment: "INPUT_REQUIRED" });
  });

  it("distinguishes manual and imported sources", () => {
    const record: Gstr9InputRecord = {
      id: createGstr9InputId("company-1", "2025-26"), companyId: "company-1", financialYear: "2025-26",
      gstr1: {
        table4: {
          b2b: { ...emptyTaxAmount(), taxableValue: 1000 }, b2cLarge: emptyTaxAmount(), exportsWithPayment: emptyTaxAmount(), sezWithPayment: emptyTaxAmount(), deemedExports: emptyTaxAmount(), advancesTaxPaid: emptyTaxAmount(), inwardSuppliesRcm: emptyTaxAmount(), b2cOther: emptyTaxAmount(), exportsWithoutPayment: emptyTaxAmount(), sezWithoutPayment: emptyTaxAmount(), advancesTaxAdjusted: emptyTaxAmount(), otherOutwardTaxableSupplies: emptyTaxAmount(), total: { ...emptyTaxAmount(), taxableValue: 1000 },
        },
        table5: { exportsWithoutPayment: emptyTaxAmount(), sezWithoutPayment: emptyTaxAmount(), suppliesOnWhichTaxPayableByRecipient: emptyTaxAmount(), exemptSupplies: emptyTaxAmount(), nilRatedSupplies: emptyTaxAmount(), nonGstSupplies: emptyTaxAmount(), total: emptyTaxAmount() },
        metadata: { source: "MANUAL", enteredAt: "2026-09-26T10:00:00.000Z", updatedAt: "2026-09-26T10:00:00.000Z" },
      },
      taxPayment: {
        table9: { taxPaid: { ...emptyTaxPaid(), igst: 100, interest: 25, lateFee: 10, penalty: 5 } }, basedOnBooks: true,
        metadata: { source: "IMPORT", enteredAt: "2026-09-26T10:00:00.000Z", updatedAt: "2026-09-26T10:00:00.000Z", sourceName: "Books GST payment import" },
      },
    };
    expect(getGstr9InputStatus(record)).toEqual({ gstr1: "MANUAL", gstr3b: "INPUT_REQUIRED", gstr2b: "INPUT_REQUIRED", itcTables: "INPUT_REQUIRED", taxPayment: "IMPORTED" });
  });

  it("separates GST tax from interest, late fee, penalty and others", () => {
    const taxPaid = { ...emptyTaxPaid(), igst: 1000, cgst: 500, sgst: 500, cess: 100, interest: 50, lateFee: 20, penalty: 10, others: 5 };
    expect(totalGstrTaxPaid(taxPaid)).toBe(2100);
    expect(totalGstrNonTaxPayment(taxPaid)).toBe(85);
  });

  it("creates a stable company/FY key", () => {
    expect(createGstr9InputId("abc", "2025-26")).toBe("abc:2025-26");
  });
});
