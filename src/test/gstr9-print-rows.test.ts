import { describe, expect, it } from "vitest";
import { resolveGstr9PrintOutward, sumGstr9PrintRows } from "@/lib/gstr9-print-rows";
import type { Gstr9Result, Gstr9TaxTotals } from "@/lib/gstr9";
import type { Gstr9Table4 } from "@/lib/gstr9-inputs";

const totals = (taxableValue: number, cgst = 0, sgst = 0, igst = 0): Gstr9TaxTotals => ({
  taxableValue, igst, cgst, sgst, cess: 0, totalTax: cgst + sgst + igst, grossValue: taxableValue + cgst + sgst + igst,
});

const amount = (taxableValue: number, cgst = 0, sgst = 0, igst = 0) => ({
  taxableValue, igst, cgst, sgst, cess: 0,
});

function resultWith(outward: Partial<Gstr9Result["outward"]>): Gstr9Result {
  return {
    outward: {
      registeredTaxable: totals(0),
      unregisteredTaxable: totals(0),
      zeroRatedWithPayment: totals(0),
      zeroRatedWithoutPayment: totals(0),
      deemedExport: totals(0),
      nilRated: totals(0),
      exempt: totals(0),
      nonGst: totals(0),
      totalOutward: totals(0),
      ...outward,
    },
    notes: { creditNotes: totals(0), debitNotes: totals(0) },
  } as unknown as Gstr9Result;
}

describe("GSTR-9 print rows (PDF matches Excel exports)", () => {
  it("Table 4 B2C and B2B come from books, not the stale saved GSTR-1 input", () => {
    // Exact figures from the customer's files: saved GSTR-1 input showed
    // B2C ₹7,28,858 while books (and the Excel exports) show ₹26,90,660.55.
    const result = resultWith({
      unregisteredTaxable: totals(2690660.55, 68336.1, 68336.1, 173732.46),
      registeredTaxable: totals(3294500.02, 6840, 6840, 455870),
    });
    const staleTable4 = {
      b2cOther: amount(728858, 7056, 7056, 60012.28),
      b2b: amount(3294500, 6840, 6840, 455870),
    } as unknown as Gstr9Table4;

    const rows = resolveGstr9PrintOutward(result, staleTable4, undefined);

    expect(rows.t4A?.taxableValue).toBeCloseTo(2690660.55, 2);
    expect(rows.t4A?.igst).toBeCloseTo(173732.46, 2);
    expect(rows.t4B?.taxableValue).toBeCloseTo(3294500.02, 2);
  });

  it("4H sub-total equals the sum of the printed 4A–4G rows", () => {
    const result = resultWith({
      unregisteredTaxable: totals(2690660.55, 68336.1, 68336.1, 173732.46),
      registeredTaxable: totals(3294500.02, 6840, 6840, 455870),
      zeroRatedWithPayment: totals(100, 9, 9, 0),
      deemedExport: totals(50, 0, 0, 9),
    });
    const rows = resolveGstr9PrintOutward(result, undefined, undefined);
    const expected = sumGstr9PrintRows(rows.t4A, rows.t4B, rows.t4C, rows.t4D, rows.t4E, rows.t4F, rows.t4G);
    expect(rows.h4).toEqual(expected);
    expect(rows.h4.taxableValue).toBeCloseTo(5985310.57, 2);
  });

  it("Table 5 uses books values and 5G sums the printed rows", () => {
    const result = resultWith({
      zeroRatedWithoutPayment: totals(60000),
      exempt: totals(123200),
      nilRated: totals(0),
      nonGst: totals(0),
    });
    const rows = resolveGstr9PrintOutward(result, undefined, undefined);
    expect(rows.t5A?.taxableValue).toBe(60000);
    expect(rows.t5D?.taxableValue).toBe(123200);
    expect(rows.g5.taxableValue).toBe(183200);
  });

  it("falls back to the saved GSTR-1 input only for rows the engine does not track", () => {
    const table4 = {
      sezWithPayment: amount(5000, 450, 450, 0),
      advancesTaxPaid: amount(2000, 0, 0, 360),
      inwardSuppliesRcm: amount(7000, 630, 630, 0),
    } as unknown as Gstr9Table4;
    const rows = resolveGstr9PrintOutward(resultWith({}), table4, undefined);
    expect(rows.t4D?.taxableValue).toBe(5000);
    expect(rows.t4F?.taxableValue).toBe(2000);
    expect(rows.t4G?.taxableValue).toBe(7000);
    expect(rows.h4.taxableValue).toBe(14000);
  });
});
