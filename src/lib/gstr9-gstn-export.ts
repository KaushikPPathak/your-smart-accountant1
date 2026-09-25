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
function getXmlAttribute(
  tag: string,
  attribute: string,
): string | null {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const pattern = new RegExp(
    `\\b${escapedAttribute}\\s*=\\s*["']([^"']*)["']`,
    "i",
  );

  const match = pattern.exec(tag);
  return match?.[1] ?? null;
}

function buildCellXml(
  openingTag: string,
  value: number | string | null,
): string {
  let cleanOpeningTag = openingTag
    .replace(/\s+t=["'][^"']*["']/i, "")
    .replace(/\s+t=[^\s>]+/i, "")
    .replace(/\s*\/?>$/, "");

  if (value === null) {
    return `${cleanOpeningTag}/>`;
  }

  if (typeof value === "number") {
    return `${cleanOpeningTag}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  }

  return `${cleanOpeningTag} t="inlineStr"><is><t>${xmlEscape(
    value,
  )}</t></is></c>`;
}

function setCellValue(
  worksheetXml: string,
  reference: string,
  value: number | string | null,
): string {
  const normalizedReference = reference.toUpperCase();
  const { row: rowNumber } =
    cellReferenceParts(normalizedReference);

  const cellPattern =
    /<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;

  let cellMatch: RegExpExecArray | null;

  while ((cellMatch = cellPattern.exec(worksheetXml)) !== null) {
    const openingEnd = cellMatch[0].indexOf(">");
    if (openingEnd < 0) {
      continue;
    }

    const openingTag = cellMatch[0].slice(0, openingEnd + 1);
    const cellReference = getXmlAttribute(openingTag, "r");

    if (
      cellReference?.toUpperCase() !==
      normalizedReference
    ) {
      continue;
    }

    const replacement = buildCellXml(
      openingTag,
      value,
    );

    return (
      worksheetXml.slice(0, cellMatch.index) +
      replacement +
      worksheetXml.slice(
        cellMatch.index + cellMatch[0].length,
      )
    );
  }

  const rowPattern =
    /<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;

  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(worksheetXml)) !== null) {
    const openingEnd = rowMatch[0].indexOf(">");
    if (openingEnd < 0) {
      continue;
    }

    const openingTag = rowMatch[0].slice(0, openingEnd + 1);
    const rowReference = getXmlAttribute(
      openingTag,
      "r",
    );

    if (Number(rowReference) !== rowNumber) {
      continue;
    }

    const newCell = buildCellXml(
      `<c r="${normalizedReference}">`,
      value,
    );

    const rowXml = rowMatch[0];
    const closeRowIndex = rowXml.lastIndexOf(
      "</row>",
    );

    if (closeRowIndex < 0) {
      throw new Error(
        `GSTN template row ${rowNumber} has invalid XML while writing ${normalizedReference}.`,
      );
    }

    const updatedRow =
      rowXml.slice(0, closeRowIndex) +
      newCell +
      rowXml.slice(closeRowIndex);

    return (
      worksheetXml.slice(0, rowMatch.index) +
      updatedRow +
      worksheetXml.slice(
        rowMatch.index + rowXml.length,
      )
    );
  }

  throw new Error(
    `GSTN template row ${rowNumber} was not found while writing ${normalizedReference}.`,
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
  const calcPrPattern =
    /<calcPr\b([^>]*)\/>/;

  const upsertAttribute = (
    attributes: string,
    name: string,
    value: string,
  ): string => {
    const attributePattern = new RegExp(
      `\\b${name}\\s*=\\s*["'][^"']*["']`,
      "i",
    );

    if (attributePattern.test(attributes)) {
      return attributes.replace(
        attributePattern,
        `${name}="${value}"`,
      );
    }

    return `${attributes} ${name}="${value}"`;
  };

  const calcPrMatch = calcPrPattern.exec(
    workbookXml,
  );

  if (calcPrMatch) {
    let attributes = calcPrMatch[1];
    attributes = upsertAttribute(
      attributes,
      "fullCalcOnLoad",
      "1",
    );
    attributes = upsertAttribute(
      attributes,
      "forceFullCalc",
      "1",
    );

    return workbookXml.replace(
      calcPrPattern,
      `<calcPr${attributes}/>`,
    );
  }

  return workbookXml.replace(
    "</workbook>",
    '<calcPr calcId="191029" fullPrecision="0" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
  );
}

async function resolveWorksheetPath(
  zip: JSZip,
  workbookXml: string,
  sheetName: string,
): Promise<string> {
  const sheetsMatch = /<sheets\b[\s\S]*?<\/sheets>/.exec(
    workbookXml,
  );

  if (!sheetsMatch) {
    throw new Error(
      "The GSTN GSTR-9 workbook does not contain a sheets section.",
    );
  }

  const sheetTagPattern =
    /<sheet\b[^>]*\/>/g;

  let sheetMatch: RegExpExecArray | null;
  let relationshipId: string | null = null;

  while (
    (sheetMatch = sheetTagPattern.exec(
      sheetsMatch[0],
    )) !== null
  ) {
    const tag = sheetMatch[0];
    const name = getXmlAttribute(tag, "name");

    if (name === sheetName) {
      relationshipId = getXmlAttribute(
        tag,
        "id",
      );

      if (!relationshipId) {
        throw new Error(
          `GSTN worksheet "${sheetName}" has no relationship id.`,
        );
      }

      break;
    }
  }

  if (!relationshipId) {
    throw new Error(
      `GSTN worksheet "${sheetName}" was not found in the official template.`,
    );
  }

  const relationshipsFile = zip.file(
    "xl/_rels/workbook.xml.rels",
  );

  if (!relationshipsFile) {
    throw new Error(
      "The GSTN GSTR-9 workbook relationships file is missing.",
    );
  }

  const relationshipsXml =
    await relationshipsFile.async("string");

  const relationshipPattern =
    /<Relationship\b[^>]*\/>/g;

  let relationshipMatch: RegExpExecArray | null;

  while (
    (relationshipMatch =
      relationshipPattern.exec(
        relationshipsXml,
      )) !== null
  ) {
    const tag = relationshipMatch[0];

    if (
      getXmlAttribute(tag, "Id") !==
      relationshipId
    ) {
      continue;
    }

    const target = getXmlAttribute(
      tag,
      "Target",
    );

    if (!target) {
      break;
    }

    const normalizedTarget = target
      .replace(/^\/+/, "")
      .replace(/^xl\//, "");

    return `xl/${normalizedTarget}`;
  }

  throw new Error(
    `GSTN worksheet relationship "${relationshipId}" for "${sheetName}" was not found.`,
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

  const workbookFile = zip.file(
    "xl/workbook.xml",
  );

  if (!workbookFile) {
    throw new Error(
      "The GSTN GSTR-9 template workbook.xml is missing.",
    );
  }

  let workbookXml =
    await workbookFile.async("string");

  // Resolve worksheets by their official GSTN sheet names
  // instead of relying on fixed sheet numbers. This keeps the
  // exporter aligned with the actual v2.1 workbook structure.
  const homePath = await resolveWorksheetPath(
    zip,
    workbookXml,
    "Home",
  );

  const table4Path =
    await resolveWorksheetPath(
      zip,
      workbookXml,
      "4 Outward",
    );

  const table5Path =
    await resolveWorksheetPath(
      zip,
      workbookXml,
      "5 Outward",
    );

  const table17Path =
    await resolveWorksheetPath(
      zip,
      workbookXml,
      "17 HSN Outward",
    );

  const home = zip.file(homePath);
  const table4 = zip.file(table4Path);
  const table5 = zip.file(table5Path);
  const table17 = zip.file(table17Path);

  if (
    !home ||
    !table4 ||
    !table5 ||
    !table17
  ) {
    throw new Error(
      "The GSTN GSTR-9 template does not contain all required worksheets.",
    );
  }

  let homeXml =
    await home.async("string");

  let table4Xml =
    await table4.async("string");

  let table5Xml =
    await table5.async("string");

  let table17Xml =
    await table17.async("string");

  homeXml = setCells(homeXml, {
    B6:
      result.company.gstin ?? "",
    D6:
      result.period.financialYear,
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

  zip.file(homePath, homeXml);
  zip.file(table4Path, table4Xml);
  zip.file(table5Path, table5Xml);
  zip.file(table17Path, table17Xml);
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
