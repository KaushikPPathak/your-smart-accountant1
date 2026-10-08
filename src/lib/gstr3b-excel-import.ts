import * as XLSX from "xlsx";
import type { Gstr9Gstr3bPeriod, Gstr9TaxAmount, Gstr9TaxPaid } from "./gstr9-inputs";

export interface Gstr3bExcelMetadata {
  companyName: string | null;
  gstin: string | null;
  financialYear: string | null;
  month: string | null;
  sheetStatus: string | null;
  sheetName: string;
}

export interface Gstr3bExcelAnalysis {
  fileName: string | null;
  metadata: Gstr3bExcelMetadata;
  period: Gstr9Gstr3bPeriod;
  warnings: string[];
}

const SHEET_NAME = "GSTR-3B";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normaliseHeader(value: unknown): string {
  return text(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = text(value)
    .replace(/,/g, "")
    .replace(/[₹$]/g, "")
    .replace(/\(([^)]+)\)/, "-$1");

  if (!raw) return 0;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseFinancialYear(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  const match = raw.match(/(20\d{2})\s*[-\/]\s*(20\d{2}|\d{2})/);
  if (!match) return null;

  const start = Number(match[1]);
  const endRaw = match[2];
  const end =
    endRaw.length === 2
      ? Number(`${String(start).slice(0, 2)}${endRaw}`)
      : Number(endRaw);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return `${start}-${String(end % 100).padStart(2, "0")}`;
}

function normaliseMonth(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  const match = raw.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+20\d{2})?$/i,
  );

  if (match) {
    return (
      match[1][0].toUpperCase() +
      match[1].slice(1).toLowerCase()
    );
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const parsedNumber = Number(raw);
  if (
    Number.isInteger(parsedNumber) &&
    parsedNumber >= 1 &&
    parsedNumber <= 12
  ) {
    return monthNames[parsedNumber - 1];
  }

  return null;
}

function expectedPeriodForMonth(
  financialYear: string,
  month: string,
): string | null {
  const startYear = Number(financialYear.slice(0, 4));
  if (!Number.isFinite(startYear)) return null;

  const monthIndex = [
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "January",
    "February",
    "March",
  ].indexOf(month);

  if (monthIndex < 0) return null;

  const year = monthIndex < 9 ? startYear : startYear + 1;
  return `${month} ${year}`;
}

function cellValue(
  sheet: XLSX.WorkSheet,
  row: number,
  column: number,
): unknown {
  return sheet[
    XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })
  ]?.v;
}

function mergedLabelValue(
  sheet: XLSX.WorkSheet,
  row: number,
  column: number,
): unknown {
  const direct = cellValue(sheet, row, column);
  if (direct !== undefined && direct !== null && text(direct)) {
    return direct;
  }

  for (const range of sheet["!merges"] ?? []) {
    if (
      range.s.r <= row - 1 &&
      range.e.r >= row - 1 &&
      range.s.c <= column - 1 &&
      range.e.c >= column - 1
    ) {
      return sheet[XLSX.utils.encode_cell(range.s)]?.v;
    }
  }

  return undefined;
}

function taxAmountFromRow(
  sheet: XLSX.WorkSheet,
  row: number,
): Gstr9TaxAmount {
  return {
    taxableValue: numberValue(cellValue(sheet, row, 3)),
    igst: numberValue(cellValue(sheet, row, 4)),
    cgst: numberValue(cellValue(sheet, row, 5)),
    sgst: numberValue(cellValue(sheet, row, 6)),
    cess: numberValue(cellValue(sheet, row, 7)),
  };
}

function totalTaxAmount(
  ...rows: Gstr9TaxAmount[]
): Gstr9TaxAmount {
  return rows.reduce(
    (total, row) => ({
      taxableValue: total.taxableValue + row.taxableValue,
      igst: total.igst + row.igst,
      cgst: total.cgst + row.cgst,
      sgst: total.sgst + row.sgst,
      cess: total.cess + row.cess,
    }),
    {
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
  );
}

function taxTotal(row: Gstr9TaxAmount): number {
  return row.igst + row.cgst + row.sgst + row.cess;
}

function taxPaidRow(
  sheet: XLSX.WorkSheet,
  row: number,
  itcColumn: number,
): Gstr9TaxPaid["igst"] {
  return {
    taxPayable: numberValue(cellValue(sheet, row, 3)),
    paidThroughCash: numberValue(cellValue(sheet, row, 9)),
    paidThroughItc: numberValue(cellValue(sheet, row, itcColumn)),
  };
}

function addTaxPaidRows(
  first: Gstr9TaxPaid["igst"],
  second: Gstr9TaxPaid["igst"],
): Gstr9TaxPaid["igst"] {
  return {
    taxPayable: first.taxPayable + second.taxPayable,
    paidThroughCash: first.paidThroughCash + second.paidThroughCash,
    paidThroughItc: first.paidThroughItc + second.paidThroughItc,
  };
}

function makePeriod(
  period: string,
  outwardTax: Gstr9TaxAmount,
  itcRows: {
    importOfGoods: Gstr9TaxAmount;
    importOfServices: Gstr9TaxAmount;
    rcm: Gstr9TaxAmount;
    isd: Gstr9TaxAmount;
    other: Gstr9TaxAmount;
  },
  reversalRows: {
    combined: Gstr9TaxAmount;
    other: Gstr9TaxAmount;
  },
  taxPaid: Gstr9TaxPaid,
): Gstr9Gstr3bPeriod {
  const table4A1ImportOfGoods = taxTotal(itcRows.importOfGoods);
  const table4A2ImportOfServices = taxTotal(itcRows.importOfServices);
  const table4A3Rcm = taxTotal(itcRows.rcm);
  const table4A4Isd = taxTotal(itcRows.isd);
  const table4A5Other = taxTotal(itcRows.other);

  const other = taxTotal(reversalRows.other);

  return {
    period,
    outwardTax,
    itc: {
      table4A1ImportOfGoods,
      table4A2ImportOfServices,
      table4A3Rcm,
      table4A4Isd,
      table4A5Other,
      totalItcAvailed:
        table4A1ImportOfGoods +
        table4A2ImportOfServices +
        table4A3Rcm +
        table4A4Isd +
        table4A5Other,
    },
    itcReversal: {
      // GSTN GSTR-3B row 4(B)(1) combines Rules 38, 42, 43 and
      // section 17(5). It is deliberately not assigned to one
      // GSTR-9 category by this importer.
      rule38: 0,
      rule42: 0,
      rule43: 0,
      section17_5: 0,
      other,
      total: other,
    },
    taxPaid,
  };
}

function findMetadata(
  sheet: XLSX.WorkSheet,
): Gstr3bExcelMetadata {
  return {
    companyName: text(mergedLabelValue(sheet, 6, 3)) || null,
    gstin: text(mergedLabelValue(sheet, 5, 3)).toUpperCase() || null,
    financialYear: normaliseFinancialYear(
      mergedLabelValue(sheet, 5, 6),
    ),
    month: normaliseMonth(
      mergedLabelValue(sheet, 6, 6),
    ),
    sheetStatus: text(
      mergedLabelValue(sheet, 5, 9),
    ) || null,
    sheetName: SHEET_NAME,
  };
}

function validateExpectedFinancialYear(
  actual: string | null,
  expected: string | undefined,
  warnings: string[],
): void {
  const expectedFy = normaliseFinancialYear(expected);
  if (expectedFy && actual && expectedFy !== actual) {
    warnings.push(
      `Workbook FY ${actual} does not match selected FY ${expectedFy}. Nothing should be saved.`,
    );
  }
}

function validateExpectedGstin(
  actual: string | null,
  expected: string | undefined,
  warnings: string[],
): void {
  const expectedGstin = text(expected)
    .replace(/\s+/g, "")
    .toUpperCase();

  if (
    expectedGstin &&
    actual &&
    expectedGstin !== actual
  ) {
    warnings.push(
      `Workbook GSTIN ${actual} does not match selected GSTIN ${expectedGstin}. Nothing should be saved.`,
    );
  }
}

export function analyseGstr3bExcelBuffer(
  data: ArrayBuffer | Uint8Array,
  options: {
    fileName?: string;
    expectedFinancialYear?: string;
    expectedGstin?: string;
  } = {},
): Gstr3bExcelAnalysis {
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: false,
    raw: true,
  });

  const sheetName =
    workbook.SheetNames.find(
      (name) =>
        name.trim().toUpperCase() === SHEET_NAME,
    ) ??
    workbook.SheetNames.find(
      (name) =>
        name.trim().toUpperCase().includes(SHEET_NAME),
    );

  if (!sheetName) {
    throw new Error(
      'GSTR-3B worksheet "GSTR-3B" was not found in the workbook.',
    );
  }

  const sheet = workbook.Sheets[sheetName];
  const metadata = findMetadata(sheet);
  const warnings: string[] = [];

  validateExpectedFinancialYear(
    metadata.financialYear,
    options.expectedFinancialYear,
    warnings,
  );
  validateExpectedGstin(
    metadata.gstin,
    options.expectedGstin,
    warnings,
  );

  if (!metadata.financialYear) {
    warnings.push(
      "GSTR-3B workbook Year is blank or could not be read.",
    );
  }

  if (!metadata.month) {
    warnings.push(
      "GSTR-3B workbook Month is blank or could not be read.",
    );
  }

  const period =
    metadata.financialYear && metadata.month
      ? expectedPeriodForMonth(
          metadata.financialYear,
          metadata.month,
        )
      : null;

  if (!period) {
    throw new Error(
      "The GSTR-3B workbook must contain a valid Year and Month before it can be imported.",
    );
  }

  const outwardTax = taxAmountFromRow(sheet, 16);

  const itcRows = {
    importOfGoods: taxAmountFromRow(sheet, 31),
    importOfServices: taxAmountFromRow(sheet, 32),
    rcm: taxAmountFromRow(sheet, 33),
    isd: taxAmountFromRow(sheet, 34),
    other: taxAmountFromRow(sheet, 35),
  };

  const reversalRows = {
    combined: taxAmountFromRow(sheet, 37),
    other: taxAmountFromRow(sheet, 38),
  };

  const taxPaid: Gstr9TaxPaid = {
    // Rows 74-77 = non-RCM payment; rows 79-82 = RCM payment.
    // Both belong to the annual tax-paid source.
    igst: addTaxPaidRows(
      taxPaidRow(sheet, 74, 4),
      taxPaidRow(sheet, 79, 4),
    ),
    cgst: addTaxPaidRows(
      taxPaidRow(sheet, 75, 5),
      taxPaidRow(sheet, 80, 5),
    ),
    sgst: addTaxPaidRows(
      taxPaidRow(sheet, 76, 6),
      taxPaidRow(sheet, 81, 6),
    ),
    cess: addTaxPaidRows(
      taxPaidRow(sheet, 77, 7),
      taxPaidRow(sheet, 82, 7),
    ),
    interest:
      numberValue(cellValue(sheet, 65, 3)) +
      numberValue(cellValue(sheet, 65, 4)) +
      numberValue(cellValue(sheet, 65, 5)) +
      numberValue(cellValue(sheet, 65, 6)),
    lateFee:
      numberValue(cellValue(sheet, 66, 3)) +
      numberValue(cellValue(sheet, 66, 4)) +
      numberValue(cellValue(sheet, 66, 5)) +
      numberValue(cellValue(sheet, 66, 6)),
    penalty: 0,
    others: 0,
  };

  const section95 = taxAmountFromRow(sheet, 24);
  if (
    section95.taxableValue !== 0 ||
    taxTotal(section95) !== 0
  ) {
    warnings.push(
      "GSTR-3B 3.1.1 (section 9(5)) contains values, but the current GSTR-9 period model has no dedicated 3.1.1 field. These values are not stored.",
    );
  }

  if (taxTotal(reversalRows.combined) !== 0) {
    warnings.push(
      "GSTR-3B 4(B)(1) contains a combined amount for Rules 38, 42, 43 and section 17(5). The current GSTR-9 period model keeps these fields separate, so this combined source amount is not auto-assigned to any one reversal category.",
    );
  }

  const interstatePosTotal = totalTaxAmount(
    taxAmountFromRow(sheet, 125),
  );
  if (
    interstatePosTotal.taxableValue !== 0 ||
    taxTotal(interstatePosTotal) !== 0
  ) {
    warnings.push(
      "GSTR-3B 3.2 contains values, but the current GSTR-9 period model has no dedicated 3.2 place-of-supply field. These values are not stored.",
    );
  }

  return {
    fileName: options.fileName ?? null,
    metadata: {
      ...metadata,
      sheetName,
    },
    period: makePeriod(
      period,
      outwardTax,
      itcRows,
      reversalRows,
      taxPaid,
    ),
    warnings,
  };
}
