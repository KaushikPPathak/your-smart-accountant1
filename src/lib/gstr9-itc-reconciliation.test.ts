import { describe, expect, it } from "vitest";
import {
  buildGstr9ItcReconciliation,
  calculateItcTotals,
  gstr9ItcLineKey,
  setAllEligibleGstr9ItcInclusion,
  setGstr9ItcInclusion,
} from "./gstr9-itc-reconciliation";
import type { Gstr2bExcelLine } from "./gstr2b-excel-import";

function line(overrides: Partial<Gstr2bExcelLine> = {}): Gstr2bExcelLine {
  return {
    section: "B2B", supplier_gstin: "24AAAAA1111A1Z1", supplier_name: "ABC LTD",
    invoice_no: "INV-001", invoice_date: "2025-05-10", invoice_value_paise: 118000,
    taxable_paise: 100000, igst_paise: 18000, cgst_paise: 0, sgst_paise: 0, cess_paise: 0,
    rev_charge: false, gstr2b_period: "052025", gstr1_period: "042025", gstr1_filing_date: "2025-05-11",
    source_type: "GSTR1", is_einvoice_enabled: true, invoice_sub_type: "", is_ecom: false,
    itc_eligible: true, itc_reason: null, cdnr_no: null, cdnr_date: null, cdnr_type: null, ...overrides,
  };
}

describe("GSTR-9 ITC reconciliation", () => {
  it("includes eligible B2B by default even when purchase is not in Books", () => {
    const r = buildGstr9ItcReconciliation([line(), line({ invoice_no: "INV-002", supplier_gstin: "24BBBBB2222B1Z2", igst_paise: 9000, taxable_paise: 50000, invoice_value_paise: 59000 })]);
    expect(r.notInBooksCount).toBe(2);
    expect(r.selectedGstr2bItcPaise).toBe(27000);
    expect(r.regularB2b.every((x) => x.includedInGstr9)).toBe(true);
  });

  it("unticking one invoice reduces GSTR-9 credit by exactly that invoice ITC", () => {
    const r = buildGstr9ItcReconciliation([line(), line({ invoice_no: "INV-002", supplier_gstin: "24BBBBB2222B1Z2", igst_paise: 9000, taxable_paise: 50000, invoice_value_paise: 59000 })]);
    const changed = setGstr9ItcInclusion(r.regularB2b, r.regularB2b[1].key, false);
    expect(calculateItcTotals(changed.filter((x) => x.includedInGstr9)).itc_paise).toBe(18000);
    expect(changed[1].inclusion).toBe("EXCLUDED");
  });

  it("Select All includes eligible rows but never ineligible rows", () => {
    const r = buildGstr9ItcReconciliation([
      line({ invoice_no: "ELIG-1" }),
      line({ invoice_no: "ELIG-2", supplier_gstin: "24BBBBB2222B1Z2", igst_paise: 9000 }),
      line({ invoice_no: "INELIG-1", supplier_gstin: "24CCCCC3333C1Z3", itc_eligible: false, itc_reason: "Blocked credit" }),
    ], [], { defaultIncludeEligible: false });
    const all = setAllEligibleGstr9ItcInclusion(r.regularB2b, true);
    expect(all.filter((x) => x.includedInGstr9)).toHaveLength(2);
    expect(all.find((x) => x.invoice_no === "INELIG-1")?.includedInGstr9).toBe(false);
  });

  it("Unselect All removes eligible B2B from the selected GSTR-9 total", () => {
    const r = buildGstr9ItcReconciliation([line(), line({ invoice_no: "INV-002" })]);
    const allOff = setAllEligibleGstr9ItcInclusion(r.regularB2b, false);
    expect(calculateItcTotals(allOff.filter((x) => x.includedInGstr9)).itc_paise).toBe(0);
  });

  it("keeps RCM and CDNR separate from the Table 8A working amount", () => {
    const r = buildGstr9ItcReconciliation([
      line({ invoice_no: "B2B-1" }),
      line({ section: "RCM", invoice_no: "RCM-1", rev_charge: true, supplier_gstin: "24DDDDD4444D1Z4", supplier_name: "RCM", taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0 }),
      line({ section: "CDNR", invoice_no: "", cdnr_no: "CN-1", supplier_gstin: "24EEEEE5555E1Z5", supplier_name: "CN", taxable_paise: -5000, igst_paise: -900, invoice_value_paise: -5900 }),
    ]);
    expect(r.regularB2b).toHaveLength(1);
    expect(r.rcm).toHaveLength(1);
    expect(r.cdnr).toHaveLength(1);
    expect(r.rcmTotals.itc_paise).toBe(1800);
    expect(r.cdnrTotals.itc_paise).toBe(-900);
    expect(r.table8AWorkingPaise).toBe(18000);
  });

  it("allows Not in Books + Included", () => {
    const r = buildGstr9ItcReconciliation([line()], []);
    expect(r.regularB2b[0].match_status).toBe("NOT_IN_BOOKS");
    expect(r.regularB2b[0].inclusion).toBe("INCLUDED");
  });

  it("matches Books by GSTIN + invoice number with ₹2 tolerance", () => {
    const r = buildGstr9ItcReconciliation([line({ invoice_value_paise: 118100 })], [{ id: "purchase-1", supplier_gstin: "24AAAAA1111A1Z1", invoice_no: "INV 001", invoice_date: "2025-05-10", total_paise: 118000 }]);
    expect(r.matchedCount).toBe(1);
    expect(r.regularB2b[0].match_status).toBe("MATCHED_WITH_TOLERANCE");
    expect(r.regularB2b[0].matched_voucher_id).toBe("purchase-1");
  });

  it("honours saved inclusion choices", () => {
    const source = line();
    const key = gstr9ItcLineKey(source);
    const r = buildGstr9ItcReconciliation([source], [], { inclusionByKey: { [key]: false } });
    expect(r.regularB2b[0].inclusion).toBe("EXCLUDED");
    expect(r.selectedGstr2bItcPaise).toBe(0);
    expect(r.excludedRegularB2bTotals.itc_paise).toBe(18000);
  });
});
