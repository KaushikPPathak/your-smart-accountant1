import { describe, expect, it } from "vitest";
import { computeLine, applyGstOverride, sumLines } from "@/lib/gst";
import { reconcileBillTaxLines } from "@/lib/gst-bill-lines";
import { editedInvoiceTotals, validateInvoiceNumber } from "@/lib/vouchers/invoice-edit";

describe("invoice tax and round-off edits", () => {
  it("automatically splits a 100 purchase at 5% into 2.50 CGST and SGST", () => {
    const auto = sumLines([computeLine({ qty: 1, rate: 100, discount: 0, gstRate: 5 }, false)]);
    expect(auto).toMatchObject({ subtotal_paise: 10000, cgst_paise: 250, sgst_paise: 250, total_paise: 10500 });
    const first = applyGstOverride(auto, { cgst: "3", sgst: "3" }, false);
    expect(first.total_paise).toBe(10600);
    const second = applyGstOverride(auto, { cgst: "2", sgst: "2" }, false);
    expect(second.total_paise).toBe(10400);
    expect(applyGstOverride(auto, {}, false)).toEqual(auto);
  });

  it("preserves the 5000 invoice adjustment without changing taxable value", () => {
    const line = computeLine({ qty: 1, rate: 4466, discount: 0, gstRate: 12 }, true);
    const totals = editedInvoiceTotals([line], {}, true, -192);
    expect(totals).toMatchObject({ subtotal_paise: 446600, igst_paise: 53592, round_off_paise: -192, total_paise: 500000 });
  });

  it("allocates repeatedly editable header GST exactly, without taxing zero-rate goods", () => {
    const lines = [computeLine({ qty: 1, rate: 100, discount: 0, gstRate: 5 }, false),
      computeLine({ qty: 1, rate: 200, discount: 0, gstRate: 18 }, false),
      computeLine({ qty: 1, rate: 50, discount: 0, gstRate: 0 }, false)];
    const rows = reconcileBillTaxLines(lines, { cgst_paise: 2051, sgst_paise: 2051, igst_paise: 0 });
    expect(rows.reduce((sum, row) => sum + row.cgst_paise, 0)).toBe(2051);
    expect(rows.reduce((sum, row) => sum + row.sgst_paise, 0)).toBe(2051);
    expect(rows[2].cgst_paise).toBe(0);
    expect(rows.map((row) => row.taxable_paise)).toEqual([10000, 20000, 5000]);
    expect(lines[0].cgst_paise).toBe(250);
  });
});

describe("explicit invoice-number edits", () => {
  const rows = [{ id: "existing", voucher_number: "INV/25-26/007", voucher_date: "2025-04-01", voucher_type: "sales" }];
  it("accepts a changed serial while keeping slash characters", () => {
    expect(validateInvoiceNumber("INV/25-26/008", "2025-05-01", "sales", rows, "existing")).toBe("INV/25-26/008");
  });
  it("accepts an unchanged number on the same voucher", () => {
    expect(validateInvoiceNumber("INV/25-26/007", "2025-05-01", "sales", rows, "existing")).toBe("INV/25-26/007");
  });
  it("rejects a duplicate number in the same type and FY", () => {
    expect(() => validateInvoiceNumber("inv/25-26/007", "2026-03-31", "sales", rows)).toThrow("already exists");
  });
  it("allows separate FYs and purchase/sales series", () => {
    expect(validateInvoiceNumber("INV/25-26/007", "2026-04-01", "sales", rows)).toBe("INV/25-26/007");
    expect(validateInvoiceNumber("INV/25-26/007", "2025-04-01", "purchase", rows)).toBe("INV/25-26/007");
  });
});