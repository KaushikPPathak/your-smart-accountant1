// GSTR-2B yearly Excel analyser.
// Supports the yearly workbook structure used by the ZAVERI export:
// B2B, B2B [FOR RCM = Y], and CDNR sections on the GSTR2B sheet.
//
// This analyser deliberately does NOT perform purchase-register reconciliation.
// It classifies and validates the Excel data first. The existing reconciliation
// engine can consume the normal B2B reconcilable rows afterwards.

export type Gstr2bExcelSection = "B2B" | "RCM" | "CDNR";

export interface Gstr2bExcelLine {
  section: Gstr2bExcelSection;
  supplier_gstin: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string | null;
  invoice_value_paise: number;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
  rev_charge: boolean;
  gstr2b_period: string | null;
  gstr1_period: string | null;
  gstr1_filing_date: string | null;
  source_type: string;
  is_einvoice_enabled: boolean | null;
  invoice_sub_type: string;
  is_ecom: boolean | null;
  itc_eligible: boolean | null;
  itc_reason: string | null;
  cdnr_no: string | null;
  cdnr_date: string | null;
  cdnr_type: string | null;
}

export interface Gstr2bExcelTotals {
  count: number;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
  invoice_value_paise: number;
}

export interface Gstr2bExcelAnalysis {
  companyName: string | null;
  gstin: string | null;
  financialYear: string | null;
  sheetName: string;
  lines: Gstr2bExcelLine[];
  regularB2B: Gstr2bExcelLine[];
  rcm: Gstr2bExcelLine[];
  cdnr: Gstr2bExcelLine[];
  reconcilableB2B: Gstr2bExcelLine[];
  totals: {
    B2B: Gstr2bExcelTotals;
    RCM: Gstr2bExcelTotals;
    CDNR: Gstr2bExcelTotals;
  };
  warnings: string[];
}

const SECTION_LABELS: Record<Gstr2bExcelSection, string[]> = {
  B2B: ["B2B"],
  RCM: ["B2B [FOR RCM = Y]"],
  CDNR: ["CDNR"],
};

const REQUIRED_HEADERS = ["INVOICE NO", "GSTIN", "TAX. VAL", "VALUE"];

function normaliseText(value: unknown): string {
  return String(value ?? "").trim();
}

function normaliseHeader(value: unknown): string {
  return normaliseText(value).toUpperCase().replace(/\s+/g, " ");
}

function normaliseFinancialYear(value: unknown): string | null {
  const text = normaliseText(value);
  if (!text) return null;

  const m = text.match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!m) return text;

  const start = Number(m[1]);
  const end = m[2].length === 2 ? Number(`${String(start).slice(0, 2)}${m[2]}`) : Number(m[2]);
  return `${start}-${String(end).slice(-2)}`;
}

function toPaise(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);

  const text = String(value)
    .replace(/[₹,\s]/g, "")
    .replace(/^\(([^)]+)\)$/, "-$1");
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && value > 25569 && value < 80000) {
    const ms = (value - 25569) * 86_400_000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const text = normaliseText(value);
  if (!text) return null;

  let m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function asBoolean(value: unknown): boolean | null {
  const text = normaliseText(value).toUpperCase();
  if (text === "Y" || text === "YES" || text === "TRUE") return true;
  if (text === "N" || text === "NO" || text === "FALSE") return false;
  return null;
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.findIndex((header) => {
      const h = normaliseHeader(header);
      return h === alias || h.includes(alias);
    });
    if (index >= 0) return index;
  }
  return -1;
}

function totals(lines: Gstr2bExcelLine[]): Gstr2bExcelTotals {
  return lines.reduce(
    (acc, line) => ({
      count: acc.count + 1,
      taxable_paise: acc.taxable_paise + line.taxable_paise,
      igst_paise: acc.igst_paise + line.igst_paise,
      cgst_paise: acc.cgst_paise + line.cgst_paise,
      sgst_paise: acc.sgst_paise + line.sgst_paise,
      cess_paise: acc.cess_paise + line.cess_paise,
      invoice_value_paise: acc.invoice_value_paise + line.invoice_value_paise,
    }),
    {
      count: 0,
      taxable_paise: 0,
      igst_paise: 0,
      cgst_paise: 0,
      sgst_paise: 0,
      cess_paise: 0,
      invoice_value_paise: 0,
    },
  );
}

function sectionFromLabel(value: unknown): Gstr2bExcelSection | null {
  const label = normaliseHeader(value);
  if (label === SECTION_LABELS.B2B[0]) return "B2B";
  if (label === SECTION_LABELS.RCM[0]) return "RCM";
  if (label === SECTION_LABELS.CDNR[0]) return "CDNR";
  return null;
}

function isTotalRow(row: unknown[]): boolean {
  return normaliseHeader(row[0]) === "TOTAL";
}

function isDataRow(row: unknown[], ix: Record<string, number>): boolean {
  const gstin = ix.gstin >= 0 ? normaliseText(row[ix.gstin]) : "";
  return gstin.length >= 10;
}

function parseSection(
  matrix: unknown[][],
  section: Gstr2bExcelSection,
  startIndex: number,
  endIndex: number,
): Gstr2bExcelLine[] {
  let headerIndex = -1;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const row = matrix[i] ?? [];
    const headers = row.map(normaliseHeader);
    if (REQUIRED_HEADERS.every((required) => headers.some((h) => h === required || h.includes(required)))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new Error(`Could not find the header row for ${section} section.`);
  }

  const headers = matrix[headerIndex] ?? [];
  const ix = {
    invNo: findColumn(headers.map(normaliseText), ["INVOICE NO"]),
    invDate: findColumn(headers.map(normaliseText), ["INVOICE DT", "INVOICE DATE"]),
    gstin: findColumn(headers.map(normaliseText), ["GSTIN"]),
    revCharge: findColumn(headers.map(normaliseText), ["REV. CHRG", "REV CHRG"]),
    name: findColumn(headers.map(normaliseText), ["NAME"]),
    gstr2bPeriod: findColumn(headers.map(normaliseText), ["GSTR 2B PERIOD"]),
    gstr1FilingDate: findColumn(headers.map(normaliseText), ["GSTR 1 FILLING DT", "GSTR 1 FILING DT"]),
    gstr1Period: findColumn(headers.map(normaliseText), ["GSTR 1 PERIOD"]),
    taxable: findColumn(headers.map(normaliseText), ["TAX. VAL", "TAXABLE VALUE"]),
    igst: findColumn(headers.map(normaliseText), ["IGST"]),
    cgst: findColumn(headers.map(normaliseText), ["CGST"]),
    sgst: findColumn(headers.map(normaliseText), ["SGST"]),
    cess: findColumn(headers.map(normaliseText), ["CESS"]),
    value: findColumn(headers.map(normaliseText), ["VALUE"]),
    sourceType: findColumn(headers.map(normaliseText), ["SOURCE TYPE"]),
    einvoice: findColumn(headers.map(normaliseText), ["IS EINVOICE ENABLED"]),
    invoiceSubType: findColumn(headers.map(normaliseText), ["INVOICE SUB-TYPE"]),
    ecom: findColumn(headers.map(normaliseText), ["IS ECOM"]),
    eligible: findColumn(headers.map(normaliseText), ["IS ELIGIBLE ITC"]),
    reason: findColumn(headers.map(normaliseText), ["REASON"]),
    cdnrNo: findColumn(headers.map(normaliseText), ["CDNR NO"]),
    cdnrDate: findColumn(headers.map(normaliseText), ["CDNR DT"]),
    cdnrType: findColumn(headers.map(normaliseText), ["CDNR TYPE"]),
  };

  if (ix.gstin < 0 || ix.taxable < 0 || ix.value < 0) {
    throw new Error(`Required columns are missing from the ${section} section.`);
  }

  const lines: Gstr2bExcelLine[] = [];

  for (let i = headerIndex + 1; i <= endIndex; i += 1) {
    const row = matrix[i] ?? [];
    if (isTotalRow(row)) break;
    if (!isDataRow(row, ix)) continue;

    const invoiceNo = ix.invNo >= 0 ? normaliseText(row[ix.invNo]) : "";

    // Normal B2B and RCM rows must have a document number.
    // CDNR rows use CDNR NO instead of invoice number.
    if ((section === "B2B" || section === "RCM") && !invoiceNo) continue;

    const cdnrNo = ix.cdnrNo >= 0 ? normaliseText(row[ix.cdnrNo]) : "";
    if (section === "CDNR" && !cdnrNo) continue;

    lines.push({
      section,
      supplier_gstin: normaliseText(row[ix.gstin]).toUpperCase().replace(/\s+/g, ""),
      supplier_name: ix.name >= 0 ? normaliseText(row[ix.name]) : "",
      invoice_no: invoiceNo,
      invoice_date: ix.invDate >= 0 ? parseDate(row[ix.invDate]) : null,
      invoice_value_paise: toPaise(row[ix.value]),
      taxable_paise: toPaise(row[ix.taxable]),
      igst_paise: ix.igst >= 0 ? toPaise(row[ix.igst]) : 0,
      cgst_paise: ix.cgst >= 0 ? toPaise(row[ix.cgst]) : 0,
      sgst_paise: ix.sgst >= 0 ? toPaise(row[ix.sgst]) : 0,
      cess_paise: ix.cess >= 0 ? toPaise(row[ix.cess]) : 0,
      rev_charge: ix.revCharge >= 0 ? asBoolean(row[ix.revCharge]) === true : section === "RCM",
      gstr2b_period: ix.gstr2bPeriod >= 0 ? normaliseText(row[ix.gstr2bPeriod]) || null : null,
      gstr1_period: ix.gstr1Period >= 0 ? normaliseText(row[ix.gstr1Period]) || null : null,
      gstr1_filing_date: ix.gstr1FilingDate >= 0 ? parseDate(row[ix.gstr1FilingDate]) : null,
      source_type: ix.sourceType >= 0 ? normaliseText(row[ix.sourceType]) : "",
      is_einvoice_enabled: ix.einvoice >= 0 ? asBoolean(row[ix.einvoice]) : null,
      invoice_sub_type: ix.invoiceSubType >= 0 ? normaliseText(row[ix.invoiceSubType]) : "",
      is_ecom: ix.ecom >= 0 ? asBoolean(row[ix.ecom]) : null,
      itc_eligible: ix.eligible >= 0 ? asBoolean(row[ix.eligible]) : null,
      itc_reason: ix.reason >= 0 ? normaliseText(row[ix.reason]) || null : null,
      cdnr_no: section === "CDNR" ? cdnrNo || null : null,
      cdnr_date: section === "CDNR" && ix.cdnrDate >= 0 ? parseDate(row[ix.cdnrDate]) : null,
      cdnr_type: section === "CDNR" && ix.cdnrType >= 0 ? normaliseText(row[ix.cdnrType]) || null : null,
    });
  }

  return lines;
}

function findSectionIndexes(matrix: unknown[][]): Array<{ section: Gstr2bExcelSection; start: number; end: number }> {
  const found: Array<{ section: Gstr2bExcelSection; start: number; end: number }> = [];

  for (let i = 0; i < matrix.length; i += 1) {
    const section = sectionFromLabel(matrix[i]?.[0]);
    if (section) found.push({ section, start: i, end: matrix.length - 1 });
  }

  for (let i = 0; i < found.length; i += 1) {
    found[i].end = (found[i + 1]?.start ?? matrix.length) - 1;
  }

  return found;
}

function extractMetadata(matrix: unknown[][]): {
  companyName: string | null;
  gstin: string | null;
  financialYear: string | null;
} {
  let companyName: string | null = null;
  let gstin: string | null = null;
  let financialYear: string | null = null;

  for (const row of matrix.slice(0, 10)) {
    const values = row.map(normaliseText);
    for (let i = 0; i < values.length - 1; i += 1) {
      const label = values[i].toUpperCase().replace(/[:\s]+$/, "");
      if (label === "NAME") companyName = values[i + 1] || companyName;
      if (label === "GSTIN") gstin = values[i + 1] || gstin;
      if (label === "YEAR") financialYear = normaliseFinancialYear(values[i + 1]) || financialYear;
    }
  }

  return { companyName, gstin, financialYear };
}

export async function analyseGstr2bExcelBuffer(
  buffer: ArrayBuffer,
  options: {
    fileName?: string;
    expectedFinancialYear?: string;
    expectedGstin?: string;
  } = {},
): Promise<Gstr2bExcelAnalysis> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheetName =
    workbook.SheetNames.find((name) => name.trim().toUpperCase() === "GSTR2B") ??
    workbook.SheetNames.find((name) => name.trim().toUpperCase().includes("GSTR2B"));

  if (!sheetName) {
    throw new Error("GSTR2B sheet was not found in the workbook.");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];

  const metadata = extractMetadata(matrix);
  const sections = findSectionIndexes(matrix);

  if (!sections.some((s) => s.section === "B2B")) {
    throw new Error("B2B section was not found in the GSTR2B sheet.");
  }

  const allLines = sections.flatMap(({ section, start, end }) =>
    parseSection(matrix, section, start, end),
  );

  const regularB2B = allLines.filter((line) => line.section === "B2B");
  const rcm = allLines.filter((line) => line.section === "RCM");
  const cdnr = allLines.filter((line) => line.section === "CDNR");

  const warnings: string[] = [];
  const expectedFy = normaliseFinancialYear(options.expectedFinancialYear);
  if (expectedFy && metadata.financialYear && expectedFy !== metadata.financialYear) {
    warnings.push(
      `Workbook FY ${metadata.financialYear} does not match selected FY ${expectedFy}. Nothing should be saved.`,
    );
  }

  const expectedGstin = normaliseText(options.expectedGstin).toUpperCase().replace(/\s+/g, "");
  if (expectedGstin && metadata.gstin && expectedGstin !== metadata.gstin) {
    warnings.push(
      `Workbook GSTIN ${metadata.gstin} does not match selected GSTIN ${expectedGstin}. Nothing should be saved.`,
    );
  }

  return {
    companyName: metadata.companyName,
    gstin: metadata.gstin,
    financialYear: metadata.financialYear,
    sheetName,
    lines: allLines,
    regularB2B,
    rcm,
    cdnr,
    reconcilableB2B: regularB2B,
    totals: {
      B2B: totals(regularB2B),
      RCM: totals(rcm),
      CDNR: totals(cdnr),
    },
    warnings,
  };
}
