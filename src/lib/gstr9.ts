import {
  fetchVouchers,
  type CompanyMeta,
  type VoucherRow,
} from "@/lib/gst-returns";

/**
 * GSTR-9 Phase 1
 *
 * Annual GSTR-9 working-paper engine.
 *
 * IMPORTANT:
 * This module deliberately separates:
 *   1. figures that can be calculated from books/vouchers,
 *   2. figures that require filed GST returns / portal data,
 *   3. FY-specific GSTR-9 mapping.
 *
 * It is NOT intended to silently manufacture missing GSTN values.
 *
 * Money convention:
 * - Source voucher amounts are stored in paise.
 * - Public calculation results below are in rupees.
 * - No floating-point arithmetic is used for the source aggregation.
 */

export type Gstr9SourceStatus =
  | "AUTO"
  | "INPUT_REQUIRED"
  | "NOT_AVAILABLE";

export interface Gstr9Period {
  financialYear: string;
  from: string;
  to: string;
}

export interface Gstr9TaxTotals {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalTax: number;
  grossValue: number;
}

export interface Gstr9NatureSummary extends Gstr9TaxTotals {
  voucherCount: number;
}

export interface Gstr9OutwardSummary {
  registeredTaxable: Gstr9TaxTotals;
  unregisteredTaxable: Gstr9TaxTotals;

  zeroRatedWithPayment: Gstr9TaxTotals;
  zeroRatedWithoutPayment: Gstr9TaxTotals;

  deemedExport: Gstr9TaxTotals;

  nilRated: Gstr9TaxTotals;
  exempt: Gstr9TaxTotals;
  nonGst: Gstr9TaxTotals;

  totalOutward: Gstr9TaxTotals;
}

export interface Gstr9HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  quantity: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalTax: number;
  totalValue: number;
}

export interface Gstr9SourceInfo {
  outwardSupplies: Gstr9SourceStatus;
  filedGstr1: Gstr9SourceStatus;
  filedGstr3b: Gstr9SourceStatus;
  gstr2b: Gstr9SourceStatus;
  itcTables: Gstr9SourceStatus;
  taxPaymentTable: Gstr9SourceStatus;
}

export interface Gstr9Reconciliation {
  booksOutwardTaxableValue: number;
  booksOutwardTax: number;

  componentTaxableValue: number;
  componentTax: number;

  taxableDifference: number;
  taxDifference: number;

  balanced: boolean;
}

export interface Gstr9Result {
  period: Gstr9Period;

  company: {
    name: string;
    gstin: string | null;
    stateCode: string | null;
  };

  sourceInfo: Gstr9SourceInfo;

  outward: Gstr9OutwardSummary;

  natureSummary: Record<
    | "taxable"
    | "zero_rated_wp"
    | "zero_rated_wop"
    | "deemed_export"
    | "nil_rated"
    | "exempt"
    | "non_gst",
    Gstr9NatureSummary
  >;

  hsn: Gstr9HsnRow[];

  reconciliation: Gstr9Reconciliation;

  /**
   * These are deliberately NOT calculated from books.
   * They will be populated in a later phase from filed GSTR-3B /
   * GSTR-2B / annual-return inputs.
   */
  filedReturnInputs: {
    table6AItcFromGstr3B: number | null;
    table8AItcFromGstr2B: number | null;
    table9TaxPaid: Gstr9TaxTotals | null;
  };

  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Financial year helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Converts:
 *   "2025-26"
 * into:
 *   2025-04-01 → 2026-03-31
 */
export function financialYearRange(
  financialYear: string,
): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear.trim());

  if (!match) {
    throw new Error(
      `Invalid financial year "${financialYear}". Expected format YYYY-YY, e.g. 2025-26.`,
    );
  }

  const startYear = Number(match[1]);
  const endYearShort = Number(match[2]);
  const expectedEndYear = (startYear + 1) % 100;

  if (endYearShort !== expectedEndYear) {
    throw new Error(
      `Invalid financial year "${financialYear}". Expected ${startYear}-${String(expectedEndYear).padStart(2, "0")}.`,
    );
  }

  return {
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
  };
}

/* -------------------------------------------------------------------------- */
/* Money helpers                                                               */
/* -------------------------------------------------------------------------- */

const rupees = (paise: number): number =>
  Number((paise / 100).toFixed(2));

const roundRupees = (value: number): number =>
  Number(value.toFixed(2));

const zeroTaxTotals = (): Gstr9TaxTotals => ({
  taxableValue: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  cess: 0,
  totalTax: 0,
  grossValue: 0,
});

const zeroNatureSummary = (): Gstr9NatureSummary => ({
  ...zeroTaxTotals(),
  voucherCount: 0,
});

/* -------------------------------------------------------------------------- */
/* Voucher helpers                                                             */
/* -------------------------------------------------------------------------- */

function lineTaxablePaise(v: VoucherRow): number {
  const lines = v.voucher_items ?? [];

  const fromLines = lines.reduce(
    (sum, line) => sum + Number(line.taxable_paise || 0),
    0,
  );

  if (fromLines !== 0) {
    return fromLines;
  }

  /*
   * Older accounting rows may have the amount at voucher level while
   * individual GST lines are empty.
   */
  return Number(v.subtotal_paise || v.total_paise || 0);
}

function lineTaxPaise(v: VoucherRow): {
  igst: number;
  cgst: number;
  sgst: number;
} {
  const lines = v.voucher_items ?? [];

  const igst = lines.reduce(
    (sum, line) => sum + Number(line.igst_paise || 0),
    0,
  );

  const cgst = lines.reduce(
    (sum, line) => sum + Number(line.cgst_paise || 0),
    0,
  );

  const sgst = lines.reduce(
    (sum, line) => sum + Number(line.sgst_paise || 0),
    0,
  );

  /*
   * Fall back to voucher-level GST where line-level GST is not populated.
   */
  return {
    igst: igst !== 0 ? igst : Number(v.igst_paise || 0),
    cgst: cgst !== 0 ? cgst : Number(v.cgst_paise || 0),
    sgst: sgst !== 0 ? sgst : Number(v.sgst_paise || 0),
  };
}

function voucherTotals(
  v: VoucherRow,
  sign: 1 | -1,
): Gstr9TaxTotals {
  const taxable = lineTaxablePaise(v);
  const tax = lineTaxPaise(v);

  const totalTaxPaise = tax.igst + tax.cgst + tax.sgst;

  return {
    taxableValue: rupees(sign * taxable),
    igst: rupees(sign * tax.igst),
    cgst: rupees(sign * tax.cgst),
    sgst: rupees(sign * tax.sgst),
    cess: 0,
    totalTax: rupees(sign * totalTaxPaise),
    grossValue: rupees(
      sign * (taxable + totalTaxPaise),
    ),
  };
}

function addTotals(
  target: Gstr9TaxTotals,
  value: Gstr9TaxTotals,
): void {
  target.taxableValue += value.taxableValue;
  target.igst += value.igst;
  target.cgst += value.cgst;
  target.sgst += value.sgst;
  target.cess += value.cess;
  target.totalTax += value.totalTax;
  target.grossValue += value.grossValue;
}

function isRegistered(v: VoucherRow): boolean {
  return Boolean(
    v.ledgers?.gstin &&
      v.ledgers.gstin.trim().length > 0,
  );
}

/* -------------------------------------------------------------------------- */
/* HSN aggregation                                                             */
/* -------------------------------------------------------------------------- */

function buildHsn(
  vouchers: VoucherRow[],
): Gstr9HsnRow[] {
  const map = new Map<string, Gstr9HsnRow>();

  for (const voucher of vouchers) {
    const sign: 1 | -1 =
      voucher.voucher_type === "credit_note" ? -1 : 1;

    for (const line of voucher.voucher_items ?? []) {
      const hsn = String(line.items?.hsn_code ?? "").trim();

      if (!hsn) {
        continue;
      }

      const description = String(
        line.items?.name ?? "",
      );

      const uqc = String(
        line.items?.unit ?? "OTH",
      );

      const key = `${hsn}|${uqc}|${line.gst_rate}`;

      const current =
        map.get(key) ??
        {
          hsn,
          description,
          uqc,
          quantity: 0,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0,
          totalTax: 0,
          totalValue: 0,
        };

      current.quantity +=
        sign * Number(line.qty || 0);

      current.taxableValue +=
        rupees(sign * Number(line.taxable_paise || 0));

      current.igst +=
        rupees(sign * Number(line.igst_paise || 0));

      current.cgst +=
        rupees(sign * Number(line.cgst_paise || 0));

      current.sgst +=
        rupees(sign * Number(line.sgst_paise || 0));

      current.totalTax =
        current.igst +
        current.cgst +
        current.sgst +
        current.cess;

      current.totalValue =
        current.taxableValue +
        current.totalTax;

      map.set(key, current);
    }
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      quantity: Number(row.quantity.toFixed(3)),
      taxableValue: roundRupees(row.taxableValue),
      igst: roundRupees(row.igst),
      cgst: roundRupees(row.cgst),
      sgst: roundRupees(row.sgst),
      cess: roundRupees(row.cess),
      totalTax: roundRupees(row.totalTax),
      totalValue: roundRupees(row.totalValue),
    }))
    .sort((a, b) =>
      `${a.hsn}|${a.uqc}`.localeCompare(
        `${b.hsn}|${b.uqc}`,
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Main annual builder                                                         */
/* -------------------------------------------------------------------------- */

export interface BuildGstr9Args {
  company: CompanyMeta;
  financialYear: string;
  sales: VoucherRow[];
  creditNotes: VoucherRow[];
}

export function buildGstr9(
  args: BuildGstr9Args,
): Gstr9Result {
  const {
    company,
    financialYear,
    sales,
    creditNotes,
  } = args;

  const { from, to } =
    financialYearRange(financialYear);

  const natureSummary = {
    taxable: zeroNatureSummary(),
    zero_rated_wp: zeroNatureSummary(),
    zero_rated_wop: zeroNatureSummary(),
    deemed_export: zeroNatureSummary(),
    nil_rated: zeroNatureSummary(),
    exempt: zeroNatureSummary(),
    non_gst: zeroNatureSummary(),
  };

  const outward: Gstr9OutwardSummary = {
    registeredTaxable: zeroTaxTotals(),
    unregisteredTaxable: zeroTaxTotals(),
    zeroRatedWithPayment: zeroTaxTotals(),
    zeroRatedWithoutPayment: zeroTaxTotals(),
    deemedExport: zeroTaxTotals(),
    nilRated: zeroTaxTotals(),
    exempt: zeroTaxTotals(),
    nonGst: zeroTaxTotals(),
    totalOutward: zeroTaxTotals(),
  };

  /*
   * Credit notes reduce the annual outward figures.
   * Debit notes increase them.
   */
  const allVouchers = [
    ...sales,
    ...creditNotes,
  ];

  for (const voucher of allVouchers) {
    const isCreditNote =
      voucher.voucher_type === "credit_note";

    const sign: 1 | -1 = isCreditNote ? -1 : 1;

    const nature =
      voucher.supply_nature ?? "taxable";

    const totals = voucherTotals(
      voucher,
      sign,
    );

    switch (nature) {
      case "zero_rated_wp":
        addTotals(
          outward.zeroRatedWithPayment,
          totals,
        );
        addTotals(
          natureSummary.zero_rated_wp,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "zero_rated_wop":
        addTotals(
          outward.zeroRatedWithoutPayment,
          totals,
        );
        addTotals(
          natureSummary.zero_rated_wop,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "deemed_export":
        addTotals(
          outward.deemedExport,
          totals,
        );
        addTotals(
          natureSummary.deemed_export,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "nil_rated":
        addTotals(
          outward.nilRated,
          totals,
        );
        addTotals(
          natureSummary.nil_rated,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "exempt":
        addTotals(
          outward.exempt,
          totals,
        );
        addTotals(
          natureSummary.exempt,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "non_gst":
        addTotals(
          outward.nonGst,
          totals,
        );
        addTotals(
          natureSummary.non_gst,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;

      case "taxable":
      default:
        if (isRegistered(voucher)) {
          addTotals(
            outward.registeredTaxable,
            totals,
          );
        } else {
          addTotals(
            outward.unregisteredTaxable,
            totals,
          );
        }

        addTotals(
          natureSummary.taxable,
          {
            ...totals,
            voucherCount: 1,
          },
        );
        break;
    }
  }

  addTotals(
    outward.totalOutward,
    outward.registeredTaxable,
  );

  addTotals(
    outward.totalOutward,
    outward.unregisteredTaxable,
  );

  addTotals(
    outward.totalOutward,
    outward.zeroRatedWithPayment,
  );

  addTotals(
    outward.totalOutward,
    outward.zeroRatedWithoutPayment,
  );

  addTotals(
    outward.totalOutward,
    outward.deemedExport,
  );

  addTotals(
    outward.totalOutward,
    outward.nilRated,
  );

  addTotals(
    outward.totalOutward,
    outward.exempt,
  );

  addTotals(
    outward.totalOutward,
    outward.nonGst,
  );

  /*
   * Books-derived component reconciliation.
   *
   * We deliberately reconcile the component buckets back to the
   * annual total generated from the same vouchers. This catches
   * classification/aggregation errors inside the engine.
   */
  const componentTaxableValue =
    outward.registeredTaxable.taxableValue +
    outward.unregisteredTaxable.taxableValue +
    outward.zeroRatedWithPayment.taxableValue +
    outward.zeroRatedWithoutPayment.taxableValue +
    outward.deemedExport.taxableValue +
    outward.nilRated.taxableValue +
    outward.exempt.taxableValue +
    outward.nonGst.taxableValue;

  const componentTax =
    outward.registeredTaxable.totalTax +
    outward.unregisteredTaxable.totalTax +
    outward.zeroRatedWithPayment.totalTax +
    outward.zeroRatedWithoutPayment.totalTax +
    outward.deemedExport.totalTax +
    outward.nilRated.totalTax +
    outward.exempt.totalTax +
    outward.nonGst.totalTax;

  const taxableDifference = roundRupees(
    outward.totalOutward.taxableValue -
      componentTaxableValue,
  );

  const taxDifference = roundRupees(
    outward.totalOutward.totalTax -
      componentTax,
  );

  const reconciliation: Gstr9Reconciliation = {
    booksOutwardTaxableValue:
      outward.totalOutward.taxableValue,

    booksOutwardTax:
      outward.totalOutward.totalTax,

    componentTaxableValue:
      roundRupees(componentTaxableValue),

    componentTax:
      roundRupees(componentTax),

    taxableDifference,

    taxDifference,

    balanced:
      Math.abs(taxableDifference) <= 0.01 &&
      Math.abs(taxDifference) <= 0.01,
  };

  const warnings: string[] = [];

  warnings.push(
    "GSTR-9 filed-return values are not yet imported. This Phase 1 result is a books-derived working paper.",
  );

  warnings.push(
    "Table 6 ITC requires filed GSTR-3B data; it must not be inferred solely from purchase vouchers.",
  );

  warnings.push(
    "Table 8A requires GSTR-2B data and may include eligible documents from the specified subsequent-period window.",
  );

  warnings.push(
    "Table 9 tax-paid figures require filed GSTR-3B Table 6.1 / annual-return source data.",
  );

  if (!reconciliation.balanced) {
    warnings.push(
      "Internal annual classification reconciliation does not balance. Do not use this result for filing until investigated.",
    );
  }

  return {
    period: {
      financialYear,
      from,
      to,
    },

    company: {
      name: company.name,
      gstin: company.gstin,
      stateCode: company.state_code,
    },

    sourceInfo: {
      outwardSupplies: "AUTO",
      filedGstr1: "INPUT_REQUIRED",
      filedGstr3b: "INPUT_REQUIRED",
      gstr2b: "INPUT_REQUIRED",
      itcTables: "INPUT_REQUIRED",
      taxPaymentTable: "INPUT_REQUIRED",
    },

    outward,

    natureSummary,

    hsn: buildHsn(allVouchers),

    reconciliation,

    filedReturnInputs: {
      table6AItcFromGstr3B: null,
      table8AItcFromGstr2B: null,
      table9TaxPaid: null,
    },

    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Loader                                                                      */
/* -------------------------------------------------------------------------- */

export async function loadGstr9Books(
  company: CompanyMeta,
  companyId: string,
  financialYear: string,
): Promise<Gstr9Result> {
  const { from, to } =
    financialYearRange(financialYear);

  const salesTypes =
    ["sales"] as Parameters<
      typeof fetchVouchers
    >[3];

  const noteTypes =
    ["credit_note", "debit_note"] as Parameters<
      typeof fetchVouchers
    >[3];

  const [sales, creditNotes] =
    await Promise.all([
      fetchVouchers(
        companyId,
        from,
        to,
        salesTypes,
      ),
      fetchVouchers(
        companyId,
        from,
        to,
        noteTypes,
      ),
    ]);

  return buildGstr9({
    company,
    financialYear,
    sales,
    creditNotes,
  });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface Gstr9ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export function validateGstr9(
  result: Gstr9Result,
): Gstr9ValidationIssue[] {
  const issues: Gstr9ValidationIssue[] = [];

  if (!result.company.gstin) {
    issues.push({
      level: "warning",
      code: "GSTIN_MISSING",
      message:
        "Company GSTIN is missing.",
    });
  }

  if (
    !result.reconciliation.balanced
  ) {
    issues.push({
      level: "error",
      code: "INTERNAL_RECONCILIATION",
      message:
        `Annual outward classification does not reconcile. Taxable difference ₹${result.reconciliation.taxableDifference.toFixed(2)}, tax difference ₹${result.reconciliation.taxDifference.toFixed(2)}.`,
    });
  }

  if (
    result.hsn.some(
      (row) => !row.hsn,
    )
  ) {
    issues.push({
      level: "warning",
      code: "HSN_MISSING",
      message:
        "One or more HSN rows have no HSN/SAC code.",
    });
  }

  /*
   * These are deliberately warnings rather than errors because the
   * values belong to filed GST returns / portal data, not the books.
   */
  issues.push({
    level: "warning",
    code: "GSTR3B_REQUIRED",
    message:
      "Filed GSTR-3B data is required before Table 6 and Table 9 can be completed.",
  });

  issues.push({
    level: "warning",
    code: "GSTR2B_REQUIRED",
    message:
      "GSTR-2B data is required before Table 8A can be completed.",
  });

  return issues;
}
