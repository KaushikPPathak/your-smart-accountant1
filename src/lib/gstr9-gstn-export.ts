import JSZip from "jszip";
import type { Gstr9Result, Gstr9TaxTotals } from "./gstr9";
import { saveExport } from "./desktop-save";

const TEMPLATE_URL =
  "/templates/GSTR-9 Offline Tool (v2.1).xlsm";

const XLSM_MIME =
  "application/vnd.ms-excel.sheet.macroEnabled.12";

/**
 * GSTN GSTR-9 Offline Utility exporter.
 *
 * IMPORTANT:
 * - Uses the official GSTN .xlsm template stored in public/templates.
 * - Does NOT rebuild the workbook with ExcelJS.
 * - Preserves the original XLSM package, including VBA.
 * - Only writes figures that can be supported by the current
 *   Smart Accountant Gstr9Result.
 * - It deliberately does not invent filed GSTR-3B, GSTR-2B,
 *   tax-payment, refund, demand, amendment or inward-ITC data.
 */

function safeFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnNumber(column: string): number {
  let result = 0;

  for (const character of column.toUpperCase()) {
    result =
      result * 26 +
      character.charCodeAt(0) -
      "A".charCodeAt(0) +
      1;
  }

  return result;
}

function cellReferenceParts(
  reference: string,
): { column: string; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(
    reference.toUpperCase(),
  );

  if (!match) {
    throw new Error(
      `Invalid Excel cell reference: ${reference}`,
    );
  }

  return {
    column: match[1],
    row: Number(match[2]),
  };
}

/**
 * Sets a numeric or string value in an existing or styled cell.
 *
 * The template already contains styled cells for the GSTN input areas.
 * If a cell is not present in the XML, this function creates it while
 * retaining the row's existing formatting structure.
 */
function setCellValue(
  worksheetXml: string,
  reference: string,
  value: number | string | null,
): string {
  const { row: rowNumber } = cellReferenceParts(reference);

  const cellPattern = new RegExp(
    `<c\\b(?=[^>]*\\br=["']${reference}["'])[^>]*(?:/>|>[\\s\\S]*?</c>)`,
  );

  const match = cellPattern.exec(worksheetXml);

  const buildCell = (openingTag: string): string => {
    const cleanOpeningTag = openingTag
      .replace(/\s+t=["'][^"']*["']/i, "")
      .replace(/\s+t=[^\s>]+/i, "");

    const normalizedOpeningTag = cleanOpeningTag.replace(
      /\s*\/?>$/,
      ">",
    );

    if (value === null) {
      return `${normalizedOpeningTag}</c>`;
    }

    if (typeof value === "number") {
      return `${normalizedOpeningTag}<v>${value}</v></c>`;
    }

    return `${normalizedOpeningTag} t="inlineStr"><is><t>${xmlEscape(
      value,
    )}</t></is></c>`;
  };

  if (match) {
    const originalCell = match[0];
    const openingEnd = originalCell.indexOf(">");

    if (openingEnd === -1) {
      throw new Error(
        `GSTN template cell ${reference} has an invalid XML opening tag.`,
      );
    }

    const openingTag = originalCell.slice(0, openingEnd + 1);
    const replacement = buildCell(openingTag);

    return (
      worksheetXml.slice(0, match.index) +
      replacement +
      worksheetXml.slice(match.index + originalCell.length)
    );
  }

  const rowPattern = new RegExp(
    `<row\\b(?=[^>]*\\br=["']${rowNumber}["'])[^>]*>[\\s\\S]*?</row>`,
  );

  const rowMatch = rowPattern.exec(worksheetXml);

  if (!rowMatch) {
    throw new Error(
      `GSTN template row ${rowNumber} was not found while writing ${reference}.`,
    );
  }

  const rowXml = rowMatch[0];

  const newCell = buildCell(
    `<c r="${reference}">`,
  );

  const updatedRow = rowXml.replace(
    /<\/row>\s*$/,
    `${newCell}</row>`,
  );

  return (
    worksheetXml.slice(0, rowMatch.index) +
    updatedRow +
    worksheetXml.slice(rowMatch.index + rowXml.length)
  );
}

         
function setCells(
  worksheetXml: string,
  values: Record<
    string,
    number | string | null
  >,
): string {
  let result = worksheetXml;

  for (const [reference, value] of Object.entries(
    values,
  )) {
    result = setCellValue(
      result,
      reference,
      value,
    );
  }

  return result;
}

function writeTotals(
  worksheetXml: string,
  row: number,
  totals: Gstr9TaxTotals,
  taxableColumn: string,
  cgstColumn: string,
  sgstColumn: string,
  igstColumn: string,
  cessColumn: string,
): string {
  return setCells(worksheetXml, {
    [`${taxableColumn}${row}`]:
      totals.taxableValue,
    [`${cgstColumn}${row}`]:
      totals.cgst,
    [`${sgstColumn}${row}`]:
      totals.sgst,
    [`${igstColumn}${row}`]:
      totals.igst,
    [`${cessColumn}${row}`]:
      totals.cess,
  });
}

/**
 * Table 4:
 *
 * A  = B2C
 * B  = B2B
 * C  = Export with payment
 * D  = SEZ with payment
 * E  = Deemed exports
 *
 * D/F/G/G1 and amendment/note rows are intentionally not
 * fabricated because the current engine does not retain those
 * distinctions independently.
 */
function populateTable4(
  xml: string,
  result: Gstr9Result,
): string {
  let output = xml;

  output = writeTotals(
    output,
    7,
    result.outward.unregisteredTaxable,
    "F",
    "G",
    "H",
    "I",
    "J",
  );

  output = writeTotals(
    output,
    8,
    result.outward.registeredTaxable,
    "F",
    "G",
    "H",
    "I",
    "J",
  );

  output = writeTotals(
    output,
    9,
    result.outward.zeroRatedWithPayment,
    "F",
    "G",
    "H",
    "I",
    "J",
  );

  output = writeTotals(
    output,
    11,
    result.outward.deemedExport,
    "F",
    "G",
    "H",
    "I",
    "J",
  );

  return output;
}

/**
 * Table 5:
 *
 * A = Export without payment
 * D = Exempt
 * E = Nil rated
 * F = Non-GST
 *
 * RCM, section 9(5), amendments and note details are
 * not fabricated.
 */
function populateTable5(
  xml: string,
  result: Gstr9Result,
): string {
  let output = xml;

  output = writeTotals(
    output,
    7,
    result.outward.zeroRatedWithoutPayment,
    "D",
    "E",
    "F",
    "G",
    "H",
  );

  output = writeTotals(
    output,
    11,
    result.outward.exempt,
    "D",
    "E",
    "F",
    "G",
    "H",
  );

  output = writeTotals(
    output,
    12,
    result.outward.nilRated,
    "D",
    "E",
    "F",
    "G",
    "H",
  );

  output = writeTotals(
    output,
    13,
    result.outward.nonGst,
    "D",
    "E",
    "F",
    "G",
    "H",
  );

  return output;
}

/**
 * Table 17 HSN Outward.
 *
 * The current GSTR-9 engine provides HSN, description, UQC,
 * quantity and tax/value totals.
 *
 * Rate and concessional-rate applicability are deliberately
 * left blank because the current result type does not retain
 * the line GST rate/concessional classification.
 */
function populateTable17(
  xml: string,
  result: Gstr9Result,
): string {
  let output = xml;

  const startRow = 6;
  const maxRows = 20001;

  for (
    let index = 0;
    index < result.hsn.length &&
    index < maxRows;
    index += 1
  ) {
    const row = startRow + index;
    const item = result.hsn[index];

    output = setCells(output, {
      [`B${row}`]: item.hsn,
      [`C${row}`]: item.description,
      [`D${row}`]: item.uqc,
      [`E${row}`]: item.quantity,
      [`F${row}`]: item.taxableValue,

      // GSTN asks for this field, but the current engine
      // does not retain the concessional-rate classification.
      [`G${row}`]: null,

      // GSTN asks for the rate, but the current Gstr9HsnRow
      // intentionally does not expose it yet.
      [`H${row}`]: null,

      [`I${row}`]: item.igst,
      [`J${row}`]: item.cgst,
      [`K${row}`]: item.sgst,
      [`L${row}`]: item.cess,
    });
  }

  return output;
}

function updateCalculationSettings(
  workbookXml: string,
): string {
  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(
      /<calcPr\b([^>]*)\/>/,
      (_match, attributes) =>
        `<calcPr${attributes} fullCalcOnLoad="1" forceFullCalc="1"/>`,
    );
  }

  return workbookXml.replace(
    "</workbook>",
    '<calcPr calcId="191029" fullPrecision="0" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
  );
}

export async function exportGstr9GstnUtility(
  result: Gstr9Result,
): Promise<void> {
  const response = await fetch(TEMPLATE_URL);

  if (!response.ok) {
    throw new Error(
      `Unable to load the GSTN GSTR-9 Offline Tool template (${response.status}).`,
    );
  }

  const templateBytes =
    new Uint8Array(
      await response.arrayBuffer(),
    );

  const zip = await JSZip.loadAsync(
    templateBytes,
  );

  const home = zip.file(
    "xl/worksheets/sheet3.xml",
  );
  const table4 = zip.file(
    "xl/worksheets/sheet4.xml",
  );
  const table5 = zip.file(
    "xl/worksheets/sheet5.xml",
  );
  const table17 = zip.file(
    "xl/worksheets/sheet14.xml",
  );
  const workbook = zip.file(
    "xl/workbook.xml",
  );

  if (
    !home ||
    !table4 ||
    !table5 ||
    !table17 ||
    !workbook
  ) {
    throw new Error(
      "The GSTN GSTR-9 template structure is not recognized.",
    );
  }

  let homeXml = await home.async("string");
  let table4Xml =
    await table4.async("string");
  let table5Xml =
    await table5.async("string");
  let table17Xml =
    await table17.async("string");
  let workbookXml =
    await workbook.async("string");

  homeXml = setCells(homeXml, {
    B6: result.company.gstin ?? "",
    D6: result.period.financialYear,
  });

  table4Xml = populateTable4(
    table4Xml,
    result,
  );

  table5Xml = populateTable5(
    table5Xml,
    result,
  );

  table17Xml = populateTable17(
    table17Xml,
    result,
  );

  workbookXml =
    updateCalculationSettings(
      workbookXml,
    );

  zip.file(
    "xl/worksheets/sheet3.xml",
    homeXml,
  );

  zip.file(
    "xl/worksheets/sheet4.xml",
    table4Xml,
  );

  zip.file(
    "xl/worksheets/sheet5.xml",
    table5Xml,
  );

  zip.file(
    "xl/worksheets/sheet14.xml",
    table17Xml,
  );

  zip.file(
    "xl/workbook.xml",
    workbookXml,
  );

  const output =
    await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });

  const gstin = safeFilePart(
    result.company.gstin ??
      "NO-GSTIN",
  );

  const fileName =
    `GSTR9_GSTN_${gstin}_${result.period.financialYear}.xlsm`;

  await saveExport({
    subFolder: "Reports",
    fileName,
    contents: output,
    mime: XLSM_MIME,
    toastTitle:
      `GSTR-9 GSTN Utility ${result.period.financialYear}`,
  });
}
