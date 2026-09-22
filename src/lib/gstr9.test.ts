// GSTR-9 test suite
import { describe, expect, it } from "vitest";
import {
  buildGstr9,
  financialYearRange,
  validateGstr9,
  type Gstr9Result,
} from "@/lib/gstr9";
import type { VoucherRow } from "@/lib/gst-returns";

const item = (
  taxable: number,
  rate: number,
  tax: number,
  hsn: string,
) => {
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;

  return {
    qty: 1,
    rate_paise: taxable,
    taxable_paise: taxable,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: 0,
    gst_rate: rate,
    items: {
      name: hsn,
      hsn_code: hsn,
      unit: "NOS",
    },
  };
};

const voucher = (
  number: string,
  type: "sales" | "credit_note" | "debit_note",
  registered: boolean,
  items: VoucherRow["voucher_items"],
  total: number,
  supplyNature: VoucherRow["supply_nature"] = "taxable",
): VoucherRow => ({
  id: number,
  voucher_date: "2025-04-20",
  voucher_number: number,
  voucher_type: type,
  is_interstate: false,
  place_of_supply_code: "24",
  reference_no: null,
  vendor_invoice_no: null,
  vendor_invoice_date: null,
  reason: null,
  original_voucher_id: null,

  subtotal_paise: items.reduce(
    (sum, row) => sum + row.taxable_paise,
    0,
  ),

  cgst_paise: items.reduce(
    (sum, row) => sum + row.cgst_paise,
    0,
  ),

  sgst_paise: items.reduce(
    (sum, row) => sum + row.sgst_paise,
    0,
  ),

  igst_paise: items.reduce(
    (sum, row) => sum + row.igst_paise,
    0,
  ),

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
    name: registered
      ? "Registered Customer"
      : "Cash Customer",

    gstin: registered
      ? "24AAAAA0000A1Z5"
      : null,

    state_code: "24",

    gst_treatment: registered
      ? "regular"
      : "consumer",

    country: "India",
  },

  voucher_items: items,
});

const company = {
  name: "Test Company",
  gstin: "24AAAAA0000A1Z5",
  state_code: "24",
};

describe("GSTR-9 financial year", () => {
  it("converts FY 2025-26 to 1 April 2025 through 31 March 2026", () => {
    expect(
      financialYearRange("2025-26"),
    ).toEqual({
      from: "2025-04-01",
      to: "2026-03-31",
    });
  });

  it("rejects an invalid financial year", () => {
    expect(() =>
      financialYearRange("2025-27"),
    ).toThrow();
  });
});

describe("GSTR-9 outward aggregation", () => {
  it("aggregates taxable B2B and B2C supplies", () => {
    const sales = [
      voucher(
        "INV001",
        "sales",
        true,
        [
          item(
            100_000,
            18,
            9_000,
            "1001",
          ),
        ],
        118_000,
      ),

      voucher(
        "INV002",
        "sales",
        false,
        [
          item(
            50_000,
            5,
            1_250,
            "1002",
          ),
        ],
        52_500,
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: [],
    });

    expect(
      result.outward.registeredTaxable
        .taxableValue,
    ).toBe(1_000);

    expect(
      result.outward.unregisteredTaxable
        .taxableValue,
    ).toBe(500);

    expect(
      result.outward.totalOutward
        .taxableValue,
    ).toBe(1_500);

    expect(
      result.outward.totalOutward
        .totalTax,
    ).toBe(102.5);

    expect(
      result.reconciliation.balanced,
    ).toBe(true);
  });

  it("handles zero-rated supplies with payment", () => {
    const sales = [
      voucher(
        "EXP001",
        "sales",
        false,
        [
          {
            ...item(
              500_000,
              0,
              0,
              "1001",
            ),
            igst_paise: 0,
            cgst_paise: 0,
            sgst_paise: 0,
          },
        ],
        500_000,
        "zero_rated_wp",
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: [],
    });

    expect(
      result.outward.zeroRatedWithPayment
        .taxableValue,
    ).toBe(5_000);

    expect(
      result.outward.zeroRatedWithPayment
        .totalTax,
    ).toBe(0);
  });

  it("separates LUT exports from exports with payment", () => {
    const sales = [
      voucher(
        "EXP001",
        "sales",
        false,
        [
          item(
            100_000,
            0,
            0,
            "1001",
          ),
        ],
        100_000,
        "zero_rated_wp",
      ),

      voucher(
        "EXP002",
        "sales",
        false,
        [
          item(
            200_000,
            0,
            0,
            "1001",
          ),
        ],
        200_000,
        "zero_rated_wop",
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: [],
    });

    expect(
      result.outward.zeroRatedWithPayment
        .taxableValue,
    ).toBe(1_000);

    expect(
      result.outward.zeroRatedWithoutPayment
        .taxableValue,
    ).toBe(2_000);
  });

  it("handles exempt, nil-rated and non-GST supplies separately", () => {
    const sales = [
      voucher(
        "E1",
        "sales",
        false,
        [
          item(
            10_000,
            0,
            0,
            "2001",
          ),
        ],
        10_000,
        "exempt",
      ),

      voucher(
        "N1",
        "sales",
        false,
        [
          item(
            20_000,
            0,
            0,
            "2002",
          ),
        ],
        20_000,
        "nil_rated",
      ),

      voucher(
        "NG1",
        "sales",
        false,
        [
          item(
            30_000,
            0,
            0,
            "2003",
          ),
        ],
        30_000,
        "non_gst",
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: [],
    });

    expect(
      result.outward.exempt.taxableValue,
    ).toBe(100);

    expect(
      result.outward.nilRated.taxableValue,
    ).toBe(200);

    expect(
      result.outward.nonGst.taxableValue,
    ).toBe(300);
  });
});

describe("GSTR-9 credit and debit notes", () => {
  it("reduces credit notes and adds debit notes", () => {
    const sales = [
      voucher(
        "INV001",
        "sales",
        true,
        [
          item(
            100_000,
            18,
            9_000,
            "1001",
          ),
        ],
        118_000,
      ),
    ];

    const notes = [
      voucher(
        "CN001",
        "credit_note",
        true,
        [
          item(
            20_000,
            18,
            1_800,
            "1001",
          ),
        ],
        21_800,
      ),

      voucher(
        "DN001",
        "debit_note",
        true,
        [
          item(
            10_000,
            18,
            900,
            "1001",
          ),
        ],
        10_900,
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: notes,
    });

    expect(
      result.outward.totalOutward
        .taxableValue,
    ).toBe(900);

    expect(
      result.outward.totalOutward
        .totalTax,
    ).toBe(81);
  });
});

describe("GSTR-9 HSN", () => {
  it("creates annual HSN rows", () => {
    const sales = [
      voucher(
        "INV001",
        "sales",
        true,
        [
          item(
            100_000,
            5,
            2_500,
            "1001",
          ),
        ],
        105_000,
      ),

      voucher(
        "INV002",
        "sales",
        true,
        [
          item(
            50_000,
            5,
            1_250,
            "1001",
          ),
        ],
        52_500,
      ),
    ];

    const result = buildGstr9({
      company,
      financialYear: "2025-26",
      sales,
      creditNotes: [],
    });

    expect(result.hsn).toHaveLength(1);

    expect(
      result.hsn[0].hsn,
    ).toBe("1001");

    expect(
      result.hsn[0].taxableValue,
    ).toBe(1_500);

    expect(
      result.hsn[0].totalTax,
    ).toBe(37.5);
  });
});

describe("GSTR-9 validation", () => {
  it("marks filed-return data as required", () => {
    const result: Gstr9Result =
      buildGstr9({
        company,
        financialYear: "2025-26",
        sales: [],
        creditNotes: [],
      });

    const issues =
      validateGstr9(result);

    expect(
      issues.some(
        (x) =>
          x.code ===
          "GSTR3B_REQUIRED",
      ),
    ).toBe(true);

    expect(
      issues.some(
        (x) =>
          x.code ===
          "GSTR2B_REQUIRED",
      ),
    ).toBe(true);
  });
});
