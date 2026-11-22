// One row per supply nature: which GSTR-3B bucket and GSTR-1 NIL column each one lands in.
// Values in the returns are rupees: inputs are paise, outputs are paise / 100.
import { describe, expect, it } from "vitest";
import { buildGstr1, buildGstr3B, type VoucherRow } from "@/lib/gst-returns";

const COMPANY = { name: "Test", gstin: "36AAAAA0000A1Z5", state_code: "36" };

const line = (taxable: number, rate: number, tax: number, hsn: string) => ({
  qty: 1, rate_paise: taxable, taxable_paise: taxable,
  cgst_paise: tax, sgst_paise: tax, igst_paise: 0, gst_rate: rate,
  items: { name: hsn, hsn_code: hsn, unit: "NOS" },
});

function sale(number: string, lines: ReturnType<typeof line>[], nature: VoucherRow["supply_nature"], registered = true): VoucherRow {
  const subtotal = lines.reduce((s, l) => s + l.taxable_paise, 0);
  const cgst = lines.reduce((s, l) => s + l.cgst_paise, 0);
  return {
    id: number, voucher_date: "2026-04-20", voucher_number: number, voucher_type: "sales",
    is_interstate: false, place_of_supply_code: "36", reference_no: null, vendor_invoice_no: null,
    vendor_invoice_date: null, reason: null, original_voucher_id: null,
    subtotal_paise: subtotal, cgst_paise: cgst, sgst_paise: cgst, igst_paise: 0,
    total_paise: subtotal + 2 * cgst, supply_nature: nature,
    ledgers: { name: "Buyer", gstin: registered ? "36BBBBB1111B1Z5" : null, gst_treatment: registered ? "regular" : "unregistered" },
    voucher_items: lines,
  } as unknown as VoucherRow;
}

const build3B = (sales: VoucherRow[]) =>
  buildGstr3B({ company: COMPANY, from: "2026-04-01", to: "2026-04-30", fp: "042026", sales, purchases: [], creditNotes: [], debitNotes: [] });
const build1 = (sales: VoucherRow[]) =>
  buildGstr1({ company: COMPANY, from: "2026-04-01", to: "2026-04-30", fp: "042026", sales, creditNotes: [] });

describe("supply nature to return buckets", () => {
  it("taxable goes to outward taxable supplies", () => {
    const r = build3B([sale("T", [line(10000, 18, 900, "1001")], "taxable")]);
    expect(r.sup_details.osup_det.txval).toBe(100);
    expect(r.sup_details.osup_nil_exmp.txval).toBe(0);
  });

  it("nil-rated and exempt both go to the nil/exempt bucket", () => {
    const r = build3B([
      sale("N", [line(10000, 0, 0, "6911")], "nil_rated"),
      sale("E", [line(5000, 0, 0, "0201")], "exempt"),
    ]);
    expect(r.sup_details.osup_nil_exmp.txval).toBe(150);
    expect(r.sup_details.osup_det.txval).toBe(0);
  });

  it("zero-rated goes to the zero-rated bucket", () => {
    const r = build3B([sale("Z", [line(10000, 0, 0, "1001")], "zero_rated_wop")]);
    expect(r.sup_details.osup_zero.txval).toBe(100);
  });

  it("non-GST goes to the non-GST bucket", () => {
    const r = build3B([sale("X", [line(10000, 0, 0, "1001")], "non_gst")]);
    expect(r.sup_details.osup_nongst.txval).toBe(100);
  });

  it("nil-rated and exempt land in separate NIL columns in GSTR-1", () => {
    const r = build1([
      sale("N", [line(10000, 0, 0, "6911")], "nil_rated"),
      sale("E", [line(5000, 0, 0, "0201")], "exempt"),
    ]);
    const nil = r.nil.reduce((s, row) => s + row.nil_amt, 0);
    const exempt = r.nil.reduce((s, row) => s + row.expt_amt, 0);
    expect(nil).toBe(100);
    expect(exempt).toBe(50);
  });

  it("a taxable voucher with an exempt line splits the exempt part to the exempt column", () => {
    const r = build1([sale("M", [line(10000, 18, 900, "1001"), line(5000, 0, 0, "0201")], "taxable")]);
    expect(r.nil.reduce((s, row) => s + row.expt_amt, 0)).toBe(50);
    expect(r.nil.reduce((s, row) => s + row.nil_amt, 0)).toBe(0);
  });
});
