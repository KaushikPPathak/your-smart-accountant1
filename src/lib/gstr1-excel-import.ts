import * as XLSX from "xlsx";
import type {
  Gstr9Table4,
  Gstr9Table5,
  Gstr9TaxAmount,
} from "./gstr9-inputs";

export interface Gstr1ExcelSheetSummary {
  sheet: string;
  dataRows: number;
  recognisedRows: number;
  status: "READ" | "EMPTY" | "NOT_FOUND";
}

export interface Gstr1ExcelAdjustmentSummary {
  sheet: string;
  rows: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr1ExcelAnalysis {
  fileName?: string;
  companyName?: string;
  gstin?: string;
  financialYear?: string;
  table4: Gstr9Table4;
  table5: Gstr9Table5;
  sheetSummary: Gstr1ExcelSheetSummary[];
  adjustments: Gstr1ExcelAdjustmentSummary[];
  hsn: Gstr9TaxAmount & { rowCount: number };
  warnings: string[];
}

type RawRow = unknown[];

interface ColumnMap {
  taxableValue?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
  rcm?: number;
  invoiceType?: number;
  exportType?: number;
  nilRated?: number;
  exempted?: number;
  nonGst?: number;
  grossAdvance?: number;
  grossAdvanceAdjusted?: number;
}

const ZERO = (): Gstr9TaxAmount => ({
  taxableValue: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  cess: 0,
});

function emptyTable4(): Gstr9Table4 {
  return {
    b2b: ZERO(),
    b2cLarge: ZERO(),
    exportsWithPayment: ZERO(),
    sezWithPayment: ZERO(),
    deemedExports: ZERO(),
    advancesTaxPaid: ZERO(),
    inwardSuppliesRcm: ZERO(),
    b2cOther: ZERO(),
    exportsWithoutPayment: ZERO(),
    sezWithoutPayment: ZERO(),
    advancesTaxAdjusted: ZERO(),
    otherOutwardTaxableSupplies: ZERO(),
    total: ZERO(),
  };
}

function emptyTable5(): Gstr9Table5 {
  return {
    exportsWithoutPayment: ZERO(),
    sezWithoutPayment: ZERO(),
    suppliesOnWhichTaxPayableByRecipient: ZERO(),
    exemptSupplies: ZERO(),
    nilRatedSupplies: ZERO(),
    nonGstSupplies: ZERO(),
    total: ZERO(),
  };
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function addTaxAmount(target: Gstr9TaxAmount, value: Gstr9TaxAmount): void {
  target.taxableValue += value.taxableValue;
  target.igst += value.igst;
  target.cgst += value.cgst;
  target.sgst += value.sgst;
  target.cess += value.cess;
}

function finaliseTaxAmount(value: Gstr9TaxAmount): Gstr9TaxAmount {
  return {
    taxableValue: round2(value.taxableValue),
    igst: round2(value.igst),
    cgst: round2(value.cgst),
    sgst: round2(value.sgst),
    cess: round2(value.cess),
  };
}

function finaliseTable4(table: Gstr9Table4): Gstr9Table4 {
  const fields: Array<keyof Gstr9Table4> = [
    "b2b",
    "b2cLarge",
    "exportsWithPayment",
    "sezWithPayment",
    "deemedExports",
    "advancesTaxPaid",
    "inwardSuppliesRcm",
    "b2cOther",
    "exportsWithoutPayment",
    "sezWithoutPayment",
    "advancesTaxAdjusted",
    "otherOutwardTaxableSupplies",
  ];

  for (const field of fields) {
    table[field] = finaliseTaxAmount(table[field]);
  }

  const total = ZERO();
  for (const field of fields) {
    addTaxAmount(total, table[field]);
  }
  table.total = finaliseTaxAmount(total);

  return table;
}

function finaliseTable5(table: Gstr9Table5): Gstr9Table5 {
  const fields: Array<keyof Gstr9Table5> = [
    "exportsWithoutPayment",
    "sezWithoutPayment",
    "suppliesOnWhichTaxPayableByRecipient",
    "exemptSupplies",
    "nilRatedSupplies",
    "nonGstSupplies",
  ];

  for (const field of fields) {
    table[field] = finaliseTaxAmount(table[field]);
  }

  const total = ZERO();
  for (const field of fields) {
    addTaxAmount(total, table[field]);
  }
  table.total = finaliseTaxAmount(total);

  return table;
}

function cellText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normaliseHeader(value: unknown): string {
  return cellText(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = cellText(value);
  if (!text) return 0;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;

  return negative ? -parsed : parsed;
}

function isNonEmptyRow(row: RawRow): boolean {
  return row.some((value) => value != null && cellText(value) !== "");
}

function isTotalRow(row: RawRow): boolean {
  const firstText = row
    .filter((value) => value != null && cellText(value) !== "")
    .slice(0, 2)
    .map(cellText)
    .join(" ")
    .toUpperCase();

  return (
    firstText === "TOTAL" ||
    firstText.startsWith("TOTAL ") ||
    firstText === "GRAND TOTAL" ||
    firstText.startsWith("GRAND TOTAL ")
  );
}

function findHeaderRow(
  rows: RawRow[],
  required: string[],
  maxScanRows = 40,
): { index: number; columns: ColumnMap } | null {
  const limit = Math.min(rows.length, maxScanRows);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = rows[rowIndex].map(normaliseHeader);

    const hasAll = required.every((needle) =>
      headers.some((header) => header.includes(needle)),
    );

    if (!hasAll) continue;

    const column = (...needles: string[]): number | undefined => {
      const index = headers.findIndex((header) =>
        needles.some((needle) => header.includes(needle)),
      );
      return index >= 0 ? index : undefined;
    };

    return {
      index: rowIndex,
      columns: {
        taxableValue: column("TAXABLE VALUE"),
        igst: column("IGST"),
        cgst: column("CGST"),
        sgst: column("SGST"),
        cess: column("CESS"),
        rcm: column("RCM"),
        invoiceType: column("INVOICE TYPE"),
        exportType: column("EXPORT TYPE"),
        nilRated: column("NIL RATED SUPPLIES"),
        exempted: column("EXEMPTED OTHER THAN NIL RATED NON GST SUPPLY"),
        nonGst: column("NON GST SUPPLIES"),
        grossAdvance: column("GROSS ADVANCE RECEIVED"),
        grossAdvanceAdjusted: column("GROSS ADVANCE ADJUSTED"),
      },
    };
  }

  return null;
}

function taxAmountFromRow(
  row: RawRow,
  columns: ColumnMap,
  taxableFallback = 0,
): Gstr9TaxAmount {
  const taxableValue =
    columns.taxableValue == null
      ? taxableFallback
      : numberValue(row[columns.taxableValue]);

  return {
    taxableValue,
    igst: columns.igst == null ? 0 : numberValue(row[columns.igst]),
    cgst: columns.cgst == null ? 0 : numberValue(row[columns.cgst]),
    sgst: columns.sgst == null ? 0 : numberValue(row[columns.sgst]),
    cess: columns.cess == null ? 0 : numberValue(row[columns.cess]),
  };
}

function grossAdvanceTaxable(
  row: RawRow,
  columns: ColumnMap,
): Gstr9TaxAmount {
  const gross =
    columns.grossAdvance == null
      ? 0
      : numberValue(row[columns.grossAdvance]);

  const amount = taxAmountFromRow(row, columns);
  return {
    ...amount,
    taxableValue: round2(
      gross -
        amount.igst -
        amount.cgst -
        amount.sgst -
        amount.cess,
    ),
  };
}

function grossAdvanceAdjustedTaxable(
  row: RawRow,
  columns: ColumnMap,
): Gstr9TaxAmount {
  const gross =
    columns.grossAdvanceAdjusted == null
      ? 0
      : numberValue(row[columns.grossAdvanceAdjusted]);

  const amount = taxAmountFromRow(row, columns);
  return {
    ...amount,
    taxableValue: round2(
      gross -
        amount.igst -
        amount.cgst -
        amount.sgst -
        amount.cess,
    ),
  };
}

function normaliseCode(value: unknown): string {
  return cellText(value)
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

function addAdjustment(
  list: Gstr1ExcelAdjustmentSummary[],
  sheet: string,
  rowCount: number,
  totals: Gstr9TaxAmount,
): void {
  if (rowCount === 0) return;

  list.push({
    sheet,
    rows: rowCount,
    taxableValue: round2(totals.taxableValue),
    igst: round2(totals.igst),
    cgst: round2(totals.cgst),
    sgst: round2(totals.sgst),
    cess: round2(totals.cess),
  });
}

function readSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
): RawRow[] | null {
  const actualName = workbook.SheetNames.find(
    (name) => name.trim().toLowerCase() === sheetName.toLowerCase(),
  );

  if (!actualName) return null;

  return XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[actualName], {
    header: 1,
    defval: null,
    raw: true,
  });
}

function getMetadata(
  workbook: XLSX.WorkBook,
): {
  companyName?: string;
  gstin?: string;
  financialYear?: string;
} {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return {};

  const rows = XLSX.utils.sheet_to_json<RawRow>(firstSheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  let companyName: string | undefined;
  let gstin: string | undefined;
  let financialYear: string | undefined;

  for (const row of rows.slice(0, 12)) {
    for (let index = 0; index < row.length - 1; index += 1) {
      const label = normaliseHeader(row[index]);
      const value = cellText(row[index + 1]);

      if (!value) continue;

      if (label === "NAME" || label.startsWith("NAME ")) {
        companyName ||= value;
      } else if (label === "GSTIN" || label.startsWith("GSTIN ")) {
        gstin ||= value;
      } else if (label === "YEAR" || label.startsWith("YEAR ")) {
        financialYear ||= value;
      }
    }
  }

  return {
    companyName,
    gstin,
    financialYear,
  };
}

function normaliseFinancialYear(value?: string): string | undefined {
  if (!value) return undefined;

  const cleaned = value
    .toUpperCase()
    .replace(/^FY[\s-]*/i, "")
    .trim();

  const full = /^(20\d{2})-(20\d{2})$/.exec(cleaned);
  if (full) {
    return `${full[1]}-${full[2].slice(-2)}`;
  }

  const short = /^(20\d{2})-(\d{2})$/.exec(cleaned);
  if (short) return `${short[1]}-${short[2]}`;

  return value.trim();
}

function addSheetSummary(
  summaries: Gstr1ExcelSheetSummary[],
  workbook: XLSX.WorkBook,
  sheet: string,
  dataRows: number,
  recognisedRows: number,
): void {
  const exists = workbook.SheetNames.some(
    (name) => name.trim().toLowerCase() === sheet.toLowerCase(),
  );

  summaries.push({
    sheet,
    dataRows,
    recognisedRows,
    status: !exists ? "NOT_FOUND" : dataRows === 0 ? "EMPTY" : "READ",
  });
}

function analyseB2b(
  rows: RawRow[],
  table4: Gstr9Table4,
  table5: Gstr9Table5,
): { dataRows: number; recognisedRows: number } {
  const header = findHeaderRow(rows, [
    "TAXABLE VALUE",
    "IGST",
    "CGST",
    "SGST",
  ]);

  if (!header) return { dataRows: 0, recognisedRows: 0 };

  let dataRows = 0;
  let recognisedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    dataRows += 1;

    const amount = taxAmountFromRow(row, header.columns);
    const rcm = normaliseCode(
      header.columns.rcm == null ? "" : row[header.columns.rcm],
    );
    const invoiceType = normaliseCode(
      header.columns.invoiceType == null ? "" : row[header.columns.invoiceType],
    );

    if (rcm === "Y" || rcm === "YES" || rcm === "TRUE") {
      addTaxAmount(table5.suppliesOnWhichTaxPayableByRecipient, amount);
    } else if (invoiceType.includes("SEZWP")) {
      addTaxAmount(table4.sezWithPayment, amount);
    } else if (invoiceType.includes("SEZWOP")) {
      addTaxAmount(table5.sezWithoutPayment, amount);
    } else if (
      invoiceType === "DE" ||
      invoiceType.includes("DEEMED")
    ) {
      addTaxAmount(table4.deemedExports, amount);
    } else {
      addTaxAmount(table4.b2b, amount);
    }

    recognisedRows += 1;
  }

  return { dataRows, recognisedRows };
}

function analyseSimpleTaxSheet(
  rows: RawRow[],
  target: Gstr9TaxAmount,
  required: string[],
): { dataRows: number; recognisedRows: number } {
  const header = findHeaderRow(rows, required);
  if (!header) return { dataRows: 0, recognisedRows: 0 };

  let dataRows = 0;
  let recognisedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    dataRows += 1;
    addTaxAmount(target, taxAmountFromRow(row, header.columns));
    recognisedRows += 1;
  }

  return { dataRows, recognisedRows };
}

function analyseExports(
  rows: RawRow[],
  table4: Gstr9Table4,
  table5: Gstr9Table5,
): { dataRows: number; recognisedRows: number } {
  const header = findHeaderRow(rows, [
    "EXPORT TYPE",
    "TAXABLE VALUE",
    "IGST",
  ]);

  if (!header) return { dataRows: 0, recognisedRows: 0 };

  let dataRows = 0;
  let recognisedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    dataRows += 1;

    const type = normaliseCode(
      header.columns.exportType == null ? "" : row[header.columns.exportType],
    );
    const amount = taxAmountFromRow(row, header.columns);

    if (type.includes("WPAY")) {
      addTaxAmount(table4.exportsWithPayment, amount);
    } else if (type.includes("WOPAY")) {
      addTaxAmount(table5.exportsWithoutPayment, amount);
    } else {
      // Do not guess an unknown export type.
      recognisedRows -= 1;
    }

    recognisedRows += 1;
  }

  return { dataRows, recognisedRows };
}

function analyseExempt(
  rows: RawRow[],
  table5: Gstr9Table5,
): { dataRows: number; recognisedRows: number } {
  const header = findHeaderRow(rows, [
    "NIL RATED SUPPLIES",
    "EXEMPTED OTHER THAN NIL RATED NON GST SUPPLY",
    "NON GST SUPPLIES",
  ]);

  if (!header) return { dataRows: 0, recognisedRows: 0 };

  let dataRows = 0;
  let recognisedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    dataRows += 1;

    table5.nilRatedSupplies.taxableValue +=
      header.columns.nilRated == null
        ? 0
        : numberValue(row[header.columns.nilRated]);

    table5.exemptSupplies.taxableValue +=
      header.columns.exempted == null
        ? 0
        : numberValue(row[header.columns.exempted]);

    table5.nonGstSupplies.taxableValue +=
      header.columns.nonGst == null
        ? 0
        : numberValue(row[header.columns.nonGst]);

    recognisedRows += 1;
  }

  return { dataRows, recognisedRows };
}

function analyseAdvanceSheet(
  rows: RawRow[],
  target: Gstr9TaxAmount,
  adjusted: boolean,
): { dataRows: number; recognisedRows: number } {
  const header = findHeaderRow(
    rows,
    adjusted
      ? ["GROSS ADVANCE ADJUSTED", "IGST", "CGST", "SGST"]
      : ["GROSS ADVANCE RECEIVED", "IGST", "CGST", "SGST"],
  );

  if (!header) return { dataRows: 0, recognisedRows: 0 };

  let dataRows = 0;
  let recognisedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    dataRows += 1;
    const amount = adjusted
      ? grossAdvanceAdjustedTaxable(row, header.columns)
      : grossAdvanceTaxable(row, header.columns);

    addTaxAmount(target, amount);
    recognisedRows += 1;
  }

  return { dataRows, recognisedRows };
}

function analyseAdjustments(
  workbook: XLSX.WorkBook,
): Gstr1ExcelAdjustmentSummary[] {
  const configs: Array<{
    sheet: string;
    required: string[];
    columns: string[];
  }> = [
    {
      sheet: "b2ba",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "b2csa",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "cdnr",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "cdnra",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "cdnur",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "cdnura",
      required: ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
      columns: ["TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "expa",
      required: ["TAXABLE VALUE", "IGST"],
      columns: ["TAXABLE VALUE", "IGST", "CESS"],
    },
    {
      sheet: "ata",
      required: ["GROSS ADVANCE RECEIVED", "IGST"],
      columns: ["GROSS ADVANCE RECEIVED", "IGST", "CGST", "SGST", "CESS"],
    },
    {
      sheet: "atadja",
      required: ["GROSS ADVANCE ADJUSTED", "IGST"],
      columns: ["GROSS ADVANCE ADJUSTED", "IGST", "CGST", "SGST", "CESS"],
    },
  ];

  const results: Gstr1ExcelAdjustmentSummary[] = [];

  for (const config of configs) {
    const rows = readSheetRows(workbook, config.sheet);
    if (!rows) continue;

    const header = findHeaderRow(rows, config.required);
    if (!header) continue;

    const totals = ZERO();
    let rowCount = 0;

    for (const row of rows.slice(header.index + 1)) {
      if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

      rowCount += 1;
      addTaxAmount(totals, taxAmountFromRow(row, header.columns));
    }

    addAdjustment(results, config.sheet, rowCount, totals);
  }

  return results;
}

function analyseHsn(
  workbook: XLSX.WorkBook,
): Gstr1ExcelAnalysis["hsn"] {
  const rows = readSheetRows(workbook, "hsn");
  if (!rows) return { ...ZERO(), rowCount: 0 };

  const header = findHeaderRow(rows, [
    "TAXABLE VALUE",
    "IGST",
    "CGST",
    "SGST",
  ]);

  if (!header) return { ...ZERO(), rowCount: 0 };

  const totals = ZERO();
  let rowCount = 0;

  for (const row of rows.slice(header.index + 1)) {
    if (!isNonEmptyRow(row) || isTotalRow(row)) continue;

    rowCount += 1;
    addTaxAmount(totals, taxAmountFromRow(row, header.columns));
  }

  return {
    ...finaliseTaxAmount(totals),
    rowCount,
  };
}

export function analyseGstr1ExcelBuffer(
  data: ArrayBuffer | Uint8Array,
  options?: {
    fileName?: string;
    expectedFinancialYear?: string;
  },
): Gstr1ExcelAnalysis {
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: false,
    raw: true,
  });

  const metadata = getMetadata(workbook);
  const table4 = emptyTable4();
  const table5 = emptyTable5();
  const sheetSummary: Gstr1ExcelSheetSummary[] = [];
  const warnings: string[] = [];

  const b2bRows = readSheetRows(workbook, "b2b");
  if (b2bRows) {
    const result = analyseB2b(b2bRows, table4, table5);
    addSheetSummary(
      sheetSummary,
      workbook,
      "b2b",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "b2b", 0, 0);
  }

  const b2clRows = readSheetRows(workbook, "b2cl");
  if (b2clRows) {
    const result = analyseSimpleTaxSheet(
      b2clRows,
      table4.b2cLarge,
      ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
    );
    addSheetSummary(
      sheetSummary,
      workbook,
      "b2cl",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "b2cl", 0, 0);
  }

  const b2csRows = readSheetRows(workbook, "b2cs");
  if (b2csRows) {
    const result = analyseSimpleTaxSheet(
      b2csRows,
      table4.b2cOther,
      ["TAXABLE VALUE", "IGST", "CGST", "SGST"],
    );
    addSheetSummary(
      sheetSummary,
      workbook,
      "b2cs",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "b2cs", 0, 0);
  }

  const expRows = readSheetRows(workbook, "exp");
  if (expRows) {
    const result = analyseExports(expRows, table4, table5);
    addSheetSummary(
      sheetSummary,
      workbook,
      "exp",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "exp", 0, 0);
  }

  const exempRows = readSheetRows(workbook, "exemp");
  if (exempRows) {
    const result = analyseExempt(exempRows, table5);
    addSheetSummary(
      sheetSummary,
      workbook,
      "exemp",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "exemp", 0, 0);
  }

  const atRows = readSheetRows(workbook, "at");
  if (atRows) {
    const result = analyseAdvanceSheet(atRows, table4.advancesTaxPaid, false);
    addSheetSummary(
      sheetSummary,
      workbook,
      "at",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "at", 0, 0);
  }

  const atadjRows = readSheetRows(workbook, "atadj");
  if (atadjRows) {
    const result = analyseAdvanceSheet(
      atadjRows,
      table4.advancesTaxAdjusted,
      true,
    );
    addSheetSummary(
      sheetSummary,
      workbook,
      "atadj",
      result.dataRows,
      result.recognisedRows,
    );
  } else {
    addSheetSummary(sheetSummary, workbook, "atadj", 0, 0);
  }

  const adjustments = analyseAdjustments(workbook);
  const hsn = analyseHsn(workbook);

  finaliseTable4(table4);
  finaliseTable5(table5);

  const detectedFinancialYear = normaliseFinancialYear(
    metadata.financialYear,
  );
  const expectedFinancialYear = normaliseFinancialYear(
    options?.expectedFinancialYear,
  );

  if (
    expectedFinancialYear &&
    detectedFinancialYear &&
    expectedFinancialYear !== detectedFinancialYear
  ) {
    warnings.push(
      `Workbook FY ${detectedFinancialYear} does not match selected FY ${expectedFinancialYear}. Nothing was saved.`,
    );
  }

  if (!metadata.gstin) {
    warnings.push("GSTIN could not be read from the workbook.");
  }

  if (!detectedFinancialYear) {
    warnings.push("Financial year could not be read from the workbook.");
  }

  if (adjustments.length > 0) {
    warnings.push(
      "The workbook contains amendment/credit-note/debit-note/advance-adjustment rows. These are reported separately and are NOT silently netted into Table 4/5 in this first analyser.",
    );
  }

  const requiredSheets = ["b2b", "b2cl", "b2cs", "exp", "exemp"];
  for (const sheet of requiredSheets) {
    const summary = sheetSummary.find((item) => item.sheet === sheet);
    if (!summary || summary.status === "NOT_FOUND") {
      warnings.push(`Required GSTR-1 sheet "${sheet}" was not found.`);
    }
  }

  return {
    fileName: options?.fileName,
    companyName: metadata.companyName,
    gstin: metadata.gstin,
    financialYear: detectedFinancialYear,
    table4,
    table5,
    sheetSummary,
    adjustments,
    hsn,
    warnings,
  };
}

export async function analyseGstr1ExcelFile(
  file: File,
  expectedFinancialYear?: string,
): Promise<Gstr1ExcelAnalysis> {
  const buffer = await file.arrayBuffer();

  return analyseGstr1ExcelBuffer(buffer, {
    fileName: file.name,
    expectedFinancialYear,
  });
}
