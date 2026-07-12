import { describe, expect, it } from "vitest";
import { assertGstr1Reconciled, buildGstr1, getGstr1Reconciliation, type VoucherRow } from "@/lib/gst-returns";

const item = (taxable: number, rate: number, tax: number, hsn: string) => ({
  qty: 1,
  rate_paise: taxable,
  taxable_paise: taxable,
  cgst_paise: tax,
  sgst_paise: tax,
  igst_paise: 0,
  gst_rate: rate,
  items: { name: hsn, hsn_code: hsn, unit: "NOS" },
});

const voucher = (
  number: string,
  type: "sales" | "credit_note" | "debit_note",
  registered: boolean,
  items: VoucherRow["voucher_items"],
  total: number,
  supplyNature: VoucherRow["supply_nature"] = "taxable",
): VoucherRow => ({
  id: number,
  voucher_date: "2026-04-20",
  voucher_number: number,
  voucher_type: type,
  is_interstate: false,
  place_of_supply_code: "36",
  reference_no: null,
  vendor_invoice_no: null,
  vendor_invoice_date: null,
  reason: null,
  original_voucher_id: null,
  subtotal_paise: items.reduce((sum, row) => sum + row.taxable_paise, 0),
  cgst_paise: items.reduce((sum, row) => sum + row.cgst_paise, 0),
  sgst_paise: items.reduce((sum, row) => sum + row.sgst_paise, 0),
  igst_paise: 0,
  total_paise: total,
  supply_nature: supplyNature,
  shipping_bill_no: null,
  shipping_bill_date: null,
  port_code: null,
  is_amendment: false,
  orig_invoice_no: null,
  orig_invoice_date: null,
  orig_period: null,
  ledgers: {
    name: registered ? "Registered Customer" : "Cash Customer",
    gstin: registered ? "36ADMPM6489J1ZQ" : null,
    state_code: "36",
    gst_treatment: "regular",
    country: "India",
  },
  voucher_items: items,
});

describe("GSTR-1 HSN reconciliation", () => {
  it("tallies multi-rate B2B, B2C, exempt and credit/debit notes", () => {
    const sales = [
      voucher("5", "sales", true, [item(100_00, 5, 250, "1001"), item(200_00, 18, 1_800, "1002")], 341_00),
      voucher("6", "sales", false, [item(500_00, 18, 4_500, "2001")], 590_00),
      voucher("7", "sales", true, [item(75_00, 0, 0, "3001")], 75_00, "exempt"),
      voucher("8", "sales", false, [item(125_00, 0, 0, "3002")], 125_00, "exempt"),
    ];
    const notes = [
      voucher("CN1", "credit_note", true, [item(20_00, 5, 50, "1001")], 21_00),
      voucher("DN1", "debit_note", false, [item(30_00, 18, 270, "2001")], 35_40),
      voucher("CN2", "credit_note", false, [item(10_00, 18, 90, "2001")], 11_80),
    ];

    const result = buildGstr1({
      company: { name: "Test", gstin: "36AAAAA0000A1Z5", state_code: "36" },
      from: "2026-04-01",
      to: "2026-04-30",
      fp: "042026",
      sales,
      creditNotes: notes,
    });

    expect(() => assertGstr1Reconciled(result)).not.toThrow();
    const totals = getGstr1Reconciliation(result);
    expect(totals.b2b.documentValue).toBe(totals.b2b.hsnValue);
    expect(totals.b2b.documentTaxable).toBe(totals.b2b.hsnTaxable);
    expect(totals.b2c.documentValue).toBe(totals.b2c.hsnValue);
    expect(totals.b2c.documentTaxable).toBe(totals.b2c.hsnTaxable);
    expect(result.b2cs.some((row) => row.txval < 0)).toBe(false);
  });

  it("blocks an unreconciled export payload", () => {
    const result = buildGstr1({
      company: { name: "Test", gstin: "36AAAAA0000A1Z5", state_code: "36" },
      from: "2026-04-01",
      to: "2026-04-30",
      fp: "042026",
      sales: [voucher("1", "sales", true, [item(100_00, 18, 900, "1001")], 118_00)],
      creditNotes: [],
    });
    result.hsn_b2b[0].txval += 1;
    expect(() => assertGstr1Reconciled(result)).toThrow("GSTR-1 reconciliation failed");
  });
});