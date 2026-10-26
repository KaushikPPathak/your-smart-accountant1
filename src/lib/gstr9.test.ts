// GSTR-9 test suite
import { describe, expect, it } from "vitest";
import {
  buildGstr9,
  financialYearRange,
  validateGstr9,
  summariseGstr9Hsn,
  totalGstr9Hsn,
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

describe("GSTR-9 drill-down provenance", () => {
  it("traces mixed B2B and nil-rated contributions without changing the saved invoice", () => {
    const source = voucher("MIXED-1", "sales", true, [item(10000, 18, 1800, "1001"), item(5000, 0, 0, "1002")], 16800);
    const original = structuredClone(source);
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [source], creditNotes: [] });
    expect(result.details?.outward.map((row) => [row.voucherId, row.bucket, row.taxableValue, row.totalTax])).toEqual([
      ["MIXED-1", "registeredTaxable", 100, 18], ["MIXED-1", "nilRated", 50, 0],
    ]);
    expect(source).toEqual(original);
    expect(result.details?.outward.reduce((sum, row) => sum + row.taxableValue, 0)).toBe(result.outward.totalOutward.taxableValue);
  });

  it("keeps net credit-note contributions negative and official note detail positive", () => {
    const sale = voucher("SALE-1", "sales", true, [item(10000, 18, 1800, "1001")], 11800);
    const credit = voucher("CN-1", "credit_note", true, [item(2000, 18, 360, "1001")], 2360);
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [sale], creditNotes: [credit] });
    expect(result.details?.outward.find((row) => row.voucherId === "CN-1")?.taxableValue).toBe(-20);
    expect(result.details?.notes[0].taxableValue).toBe(20);
    expect(result.details?.notes[0].totalTax).toBe(3.6);
    expect(result.details?.hsnOutward.reduce((sum, row) => sum + row.taxableValue, 0)).toBe(80);
  });

  it("traces reconciled purchase HSN lines to the existing voucher ID", () => {
    const purchase = { ...voucher("PUR-1", "sales", true, [item(10000, 18, 1800, "1001")], 12000), voucher_type: "purchase", cgst_paise: 1000, sgst_paise: 1000 };
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [], creditNotes: [], purchases: [purchase] });
    expect(result.details?.hsnInward[0]).toMatchObject({ voucherId: "PUR-1", hsn: "1001", taxableValue: 100, totalTax: 20 });
    expect(result.details?.hsnInward[0].totalTax).toBe(result.hsnInward[0].totalTax);
  });
});

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
  it("separates overseas export sales from domestic B2C and nets export notes", () => {
    const exportSale = voucher("EXP", "sales", false, [item(10000_00, 18, 1800_00, "9403")], 11800_00);
    const overseas = { ...exportSale.ledgers, name: "Overseas", gstin: null, state_code: null, country: "USA", gst_treatment: "overseas" as const };
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [{ ...exportSale, ledgers: overseas }],
      creditNotes: [{ ...voucher("ECN", "credit_note", false, [item(1000_00, 18, 180_00, "9403")], 1180_00), ledgers: overseas }] });
    expect(result.outward.zeroRatedWithPayment.taxableValue).toBe(9000);
    expect(result.outward.unregisteredTaxable.taxableValue).toBe(0);
    expect(result.outward.zeroRatedWithPayment.totalTax).toBe(1620);
  });

  it("keeps explicit export without payment separate, even for zero-rate items", () => {
    const result = buildGstr9({ company, financialYear: "2025-26", creditNotes: [], sales: [
      voucher("EXP-LUT", "sales", false, [item(5000_00, 0, 0, "9403")], 5000_00, "zero_rated_wop") ] });
    expect(result.outward.zeroRatedWithoutPayment.taxableValue).toBe(5000);
    expect(result.outward.nilRated.taxableValue).toBe(0);
    expect(result.outward.unregisteredTaxable.taxableValue).toBe(0);
  });

  it("uses edited bill tax in outward and HSN, never changes taxable for rounding", () => {
    const v = { ...voucher("ROUND", "sales", false, [item(446600, 12, 53592, "6912")], 500000), cgst_paise: 26700, sgst_paise: 26700 };
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [v], creditNotes: [] });
    expect(result.outward.unregisteredTaxable.taxableValue).toBe(4466);
    expect(result.outward.unregisteredTaxable.totalTax).toBe(534);
    expect(result.hsn[0].totalValue).toBe(5000);
    expect(v.voucher_items[0].cgst_paise).toBe(26796);
  });
  it("separates the 25000 tax-free line from INV.035 taxable sales", () => {
    const result = buildGstr9({ company, financialYear: "2025-26", creditNotes: [], sales: [
      voucher("INV.035", "sales", true, [item(25000_00, 12, 3000_00, "4911"),
        item(36000_00, 18, 6480_00, "9403"), item(25000_00, 0, 0, "69120040")], 95480_00),
    ] });
    expect(result.outward.registeredTaxable.taxableValue).toBe(61000);
    expect(result.outward.nilRated.taxableValue).toBe(25000);
    expect(result.outward.totalOutward.grossValue).toBe(95480);
    expect(result.outward.registeredTaxable.totalTax).toBe(9480);
  });

  it("reconciles 123200 tax-free HSN with nil-rated supplies, separately from 76000 exempt", () => {
    const result = buildGstr9({ company, financialYear: "2025-26", creditNotes: [], sales: [
      voucher("ZERO", "sales", false, [item(123200_00, 0, 0, "69120040")], 123200_00),
      voucher("EXEMPT", "sales", false, [item(76000_00, 0, 0, "7009")], 76000_00, "exempt"),
    ] });
    expect(result.outward.nilRated.taxableValue).toBe(123200);
    expect(result.outward.exempt.taxableValue).toBe(76000);
    expect(result.outward.unregisteredTaxable.taxableValue).toBe(0);
    expect(result.hsn.find((row) => row.hsn === "69120040")?.taxableValue).toBe(123200);
  });

  it("nets tax-free credit notes without double counting mixed invoices", () => {
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [
      voucher("MIX", "sales", true, [item(10000_00, 18, 1800_00, "1001"), item(25000_00, 0, 0, "69120040")], 36800_00),
    ], creditNotes: [voucher("CN", "credit_note", true, [item(5000_00, 0, 0, "69120040")], 5000_00)] });
    expect(result.outward.nilRated.taxableValue).toBe(20000);
    expect(result.outward.registeredTaxable.taxableValue).toBe(10000);
    expect(result.outward.totalOutward.grossValue).toBe(31800);
  });

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
  it("merges different items and rates under the same HSN in both summaries without losing tax", () => {
    const first = item(100_000, 5, 5_000, "6914");
    const second = { ...item(200_000, 18, 36_000, "6914"), qty: 3, items: { ...first.items, name: "Other material" } };
    const sales = [voucher("S1", "sales", true, [first, second], 341_000)];
    const purchases = [{ ...sales[0], voucher_type: "purchase" } as VoucherRow];
    const result = buildGstr9({ company, financialYear: "2025-26", sales, purchases, creditNotes: [] });
    for (const detail of [result.hsn, result.hsnInward]) {
      expect(detail).toHaveLength(2); // Mandatory GSTN rates remain distinct.
      const summary = summariseGstr9Hsn(detail);
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({ hsn: "6914", quantity: 4, taxableValue: 3000, cgst: 205, sgst: 205, totalTax: 410, totalValue: 3410 });
      expect(totalGstr9Hsn(summary)).toEqual(totalGstr9Hsn(detail));
    }
  });

  it("does not mix quantities in different units or different HSN codes", () => {
    const line = item(10000, 5, 500, "0713");
    const result = buildGstr9({ company, financialYear: "2025-26", creditNotes: [], sales: [voucher("S", "sales", true, [line, { ...line, items: { ...line.items, unit: "KGS" } }, item(10000, 5, 500, "071300")], 31500)] });
    expect(summariseGstr9Hsn(result.hsn)).toHaveLength(3);
    expect(totalGstr9Hsn(result.hsn).taxableValue).toBe(300);
  });

  it("nets credit notes once in consolidated HSN totals and handles empty books", () => {
    const result = buildGstr9({ company, financialYear: "2025-26", sales: [voucher("S", "sales", true, [item(10000, 5, 500, "6914")], 10500)], creditNotes: [voucher("C", "credit_note", true, [item(2000, 5, 100, "6914")], 2100)] });
    expect(totalGstr9Hsn(summariseGstr9Hsn(result.hsn))).toMatchObject({ taxableValue: 80, cgst: 2, sgst: 2, totalTax: 4, grossValue: 84 });
    expect(summariseGstr9Hsn([])).toEqual([]);
    expect(totalGstr9Hsn([]).taxableValue).toBe(0);
  });

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

describe("GSTR-9 tables 4I/4J and 18", () => {
  it("fills credit/debit notes and inward HSN from purchases", () => {
    const purchase = { ...voucher("P1", "sales", true, [item(40_000, 18, 7_200, "7208")], 47_200), voucher_type: "purchase" } as unknown as VoucherRow;
    const result = buildGstr9({
      company, financialYear: "2025-26", sales: [],
      creditNotes: [
        voucher("CN1", "credit_note", true, [item(20_000, 18, 1_800, "1001")], 21_800),
        voucher("DN1", "debit_note", true, [item(10_000, 18, 900, "1001")], 10_900),
      ],
      purchases: [purchase],
    });
    expect(result.notes.creditNotes.taxableValue).toBe(200);
    expect(result.notes.debitNotes.taxableValue).toBe(100);
    expect(result.hsnInward).toHaveLength(1);
    expect(result.hsnInward[0].hsn).toBe("7208");
    expect(result.hsnInward[0].taxableValue).toBe(400);
    expect(result.hsnInward[0].totalTax).toBe(72);
  });
});
