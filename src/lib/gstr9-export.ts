import ExcelJS from "exceljs";
import {
  validateGstr9,
  type Gstr9Result,
  type Gstr9SourceStatus,
  type Gstr9TaxTotals,
} from "./gstr9";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function statusLabel(status: Gstr9SourceStatus): string {
  switch (status) {
    case "AUTO":
      return "Available";
    case "INPUT_REQUIRED":
      return "Input required";
    default:
      return "Not available";
  }
}

function addTitle(
  worksheet: ExcelJS.Worksheet,
  title: string,
  subtitle?: string,
): void {
  worksheet.mergeCells("A1:H1");
  const cell = worksheet.getCell("A1");
  cell.value = title;
  cell.font = {
    bold: true,
    size: 16,
  };
  cell.alignment = {
    vertical: "middle",
  };
  worksheet.getRow(1).height = 26;

  if (subtitle) {
    worksheet.mergeCells("A2:H2");
    worksheet.getCell("A2").value = subtitle;
    worksheet.getCell("A2").font = {
      italic: true,
      size: 10,
    };
  }
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = {
    bold: true,
  };
  row.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
}

function styleMoneyColumns(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): void {
  for (let row = startRow; row <= endRow; row += 1) {
    for (
      let column = startColumn;
      column <= endColumn;
      column += 1
    ) {
      worksheet.getCell(row, column).numFmt = '#,##0.00';
    }
  }
}

function addTotalsRows(
  worksheet: ExcelJS.Worksheet,
  rows: Array<[string, Gstr9TaxTotals]>,
  startRow: number,
): number {
  let rowNumber = startRow;

  for (const [label, value] of rows) {
    worksheet.addRow([
      label,
      value.taxableValue,
      value.igst,
      value.cgst,
      value.sgst,
      value.totalTax,
      value.grossValue,
    ]);
    rowNumber += 1;
  }

  return rowNumber - 1;
}

function addOutwardSheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("Outward Supplies");

  addTitle(
    worksheet,
    "GSTR-9 — Books-derived Outward Supplies",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);

  const header = worksheet.addRow([
    "Particulars",
    "Taxable Value",
    "IGST",
    "CGST",
    "SGST",
    "Total Tax",
    "Gross Value",
  ]);

  styleHeader(header);

  const rows: Array<[string, Gstr9TaxTotals]> = [
    ["Registered taxable supplies", result.outward.registeredTaxable],
    ["Unregistered taxable supplies", result.outward.unregisteredTaxable],
    ["Zero-rated with payment", result.outward.zeroRatedWithPayment],
    [
      "Zero-rated without payment",
      result.outward.zeroRatedWithoutPayment,
    ],
    ["Deemed exports", result.outward.deemedExport],
    ["Nil-rated", result.outward.nilRated],
    ["Exempt", result.outward.exempt],
    ["Non-GST", result.outward.nonGst],
    ["Total outward supplies", result.outward.totalOutward],
  ];

  const endRow = addTotalsRows(worksheet, rows, header.number + 1);

  styleMoneyColumns(
    worksheet,
    header.number + 1,
    endRow,
    2,
    7,
  );

  worksheet.getRow(endRow).font = {
    bold: true,
  };

  worksheet.columns = [
    { width: 34 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
  ];

  worksheet.views = [
    {
      state: "frozen",
      ySplit: header.number,
    },
  ];
}

function addNatureSheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("Nature Summary");

  addTitle(
    worksheet,
    "GSTR-9 — Nature-wise Summary",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);

  const header = worksheet.addRow([
    "Nature",
    "Vouchers",
    "Taxable Value",
    "IGST",
    "CGST",
    "SGST",
    "Total Tax",
    "Gross Value",
  ]);

  styleHeader(header);

  const rows = [
    ["Taxable", result.natureSummary.taxable],
    [
      "Zero-rated with payment",
      result.natureSummary.zero_rated_wp,
    ],
    [
      "Zero-rated without payment",
      result.natureSummary.zero_rated_wop,
    ],
    [
      "Deemed exports",
      result.natureSummary.deemed_export,
    ],
    ["Nil-rated", result.natureSummary.nil_rated],
    ["Exempt", result.natureSummary.exempt],
    ["Non-GST", result.natureSummary.non_gst],
  ] as const;

  for (const [label, value] of rows) {
    worksheet.addRow([
      label,
      value.voucherCount,
      value.taxableValue,
      value.igst,
      value.cgst,
      value.sgst,
      value.totalTax,
      value.grossValue,
    ]);
  }

  const endRow = header.number + rows.length;

  styleMoneyColumns(
    worksheet,
    header.number + 1,
    endRow,
    3,
    8,
  );

  worksheet.columns = [
    { width: 32 },
    { width: 12 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
  ];

  worksheet.views = [
    {
      state: "frozen",
      ySplit: header.number,
    },
  ];
}

function addHsnSheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("HSN SAC Summary");

  addTitle(
    worksheet,
    "GSTR-9 — HSN / SAC Summary",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);

  const header = worksheet.addRow([
    "HSN / SAC",
    "Description",
    "UQC",
    "Quantity",
    "Taxable Value",
    "IGST",
    "CGST",
    "SGST",
    "Cess",
    "Total Tax",
    "Total Value",
  ]);

  styleHeader(header);

  for (const row of result.hsn) {
    worksheet.addRow([
      row.hsn,
      row.description,
      row.uqc,
      row.quantity,
      row.taxableValue,
      row.igst,
      row.cgst,
      row.sgst,
      row.cess,
      row.totalTax,
      row.totalValue,
    ]);
  }

  const endRow = header.number + result.hsn.length;

  for (let row = header.number + 1; row <= endRow; row += 1) {
    worksheet.getCell(row, 4).numFmt = "#,##0.000";
  }

  styleMoneyColumns(
    worksheet,
    header.number + 1,
    endRow,
    5,
    11,
  );

  worksheet.columns = [
    { width: 15 },
    { width: 34 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 18 },
  ];

  worksheet.autoFilter = {
    from: {
      row: header.number,
      column: 1,
    },
    to: {
      row: endRow,
      column: 11,
    },
  };

  worksheet.views = [
    {
      state: "frozen",
      ySplit: header.number,
    },
  ];
}

function addReconciliationSheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("Reconciliation");

  addTitle(
    worksheet,
    "GSTR-9 — Books Reconciliation",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);

  const header = worksheet.addRow([
    "Particulars",
    "Amount",
  ]);

  styleHeader(header);

  const rows = [
    [
      "Books outward taxable value",
      result.reconciliation.booksOutwardTaxableValue,
    ],
    [
      "Component taxable value",
      result.reconciliation.componentTaxableValue,
    ],
    [
      "Taxable difference",
      result.reconciliation.taxableDifference,
    ],
    [
      "Books outward tax",
      result.reconciliation.booksOutwardTax,
    ],
    [
      "Component tax",
      result.reconciliation.componentTax,
    ],
    [
      "Tax difference",
      result.reconciliation.taxDifference,
    ],
    [
      "Internal status",
      result.reconciliation.balanced
        ? "Balanced"
        : "Not balanced",
    ],
  ] as const;

  for (const row of rows) {
    worksheet.addRow(row);
  }

  styleMoneyColumns(
    worksheet,
    header.number + 1,
    header.number + rows.length - 1,
    2,
    2,
  );

  worksheet.getRow(header.number + rows.length).font = {
    bold: true,
  };

  worksheet.columns = [
    { width: 38 },
    { width: 24 },
  ];
}

function addSourceAndValidationSheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("Validation");

  addTitle(
    worksheet,
    "GSTR-9 — Source Status & Validation",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);

  const sourceHeader = worksheet.addRow([
    "Source",
    "Status",
  ]);

  styleHeader(sourceHeader);

  const sourceRows = [
    [
      "Books / outward supplies",
      statusLabel(result.sourceInfo.outwardSupplies),
    ],
    [
      "Filed GSTR-1",
      statusLabel(result.sourceInfo.filedGstr1),
    ],
    [
      "Filed GSTR-3B",
      statusLabel(result.sourceInfo.filedGstr3b),
    ],
    [
      "GSTR-2B",
      statusLabel(result.sourceInfo.gstr2b),
    ],
    [
      "ITC tables",
      statusLabel(result.sourceInfo.itcTables),
    ],
    [
      "Tax payment data",
      statusLabel(result.sourceInfo.taxPaymentTable),
    ],
  ];

  for (const row of sourceRows) {
    worksheet.addRow(row);
  }

  worksheet.addRow([]);
  worksheet.addRow(["Validation issues"]);
  worksheet.getCell(
    worksheet.lastRow?.number ?? 1,
    1,
  ).font = {
    bold: true,
  };

  const issues = validateGstr9(result);

  if (issues.length === 0) {
    worksheet.addRow(["No validation issues"]);
  } else {
    worksheet.addRow([
      "Level",
      "Code",
      "Message",
    ]);
    styleHeader(worksheet.lastRow!);

    for (const issue of issues) {
      worksheet.addRow([
        issue.level.toUpperCase(),
        issue.code,
        issue.message,
      ]);
    }
  }

  worksheet.addRow([]);
  worksheet.addRow(["Engine warnings"]);
  worksheet.getCell(
    worksheet.lastRow?.number ?? 1,
    1,
  ).font = {
    bold: true,
  };

  if (result.warnings.length === 0) {
    worksheet.addRow(["No engine warnings"]);
  } else {
    for (const warning of result.warnings) {
      worksheet.addRow([warning]);
    }
  }

  worksheet.addRow([]);
  worksheet.addRow([
    "Important",
    "Filed GSTN values are not fabricated from accounting vouchers.",
  ]);

  worksheet.columns = [
    { width: 28 },
    { width: 24 },
    { width: 90 },
  ];
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  result: Gstr9Result,
): void {
  const worksheet = workbook.addWorksheet("GSTR-9 Summary");

  addTitle(
    worksheet,
    "GSTR-9 — Annual Return Working Paper",
    `Financial Year ${result.period.financialYear}`,
  );

  worksheet.addRow([]);
  worksheet.addRow(["Company", result.company.name]);
  worksheet.addRow(["GSTIN", result.company.gstin ?? ""]);
  worksheet.addRow([
    "State Code",
    result.company.stateCode ?? "",
  ]);
  worksheet.addRow(["Financial Year", result.period.financialYear]);
  worksheet.addRow(["Period From", result.period.from]);
  worksheet.addRow(["Period To", result.period.to]);

  worksheet.addRow([]);

  worksheet.addRow([
    "Books outward taxable value",
    result.outward.totalOutward.taxableValue,
  ]);
  worksheet.addRow([
    "Books outward tax",
    result.outward.totalOutward.totalTax,
  ]);
  worksheet.addRow([
    "Books outward gross value",
    result.outward.totalOutward.grossValue,
  ]);

  worksheet.addRow([]);
  worksheet.addRow([
    "Internal reconciliation",
    result.reconciliation.balanced
      ? "Balanced"
      : "Not balanced",
  ]);

  worksheet.addRow([]);
  worksheet.addRow([
    "Filed GSTR-3B Table 6A ITC",
    result.filedReturnInputs.table6AItcFromGstr3B ??
      "Input required",
  ]);
  worksheet.addRow([
    "GSTR-2B Table 8A ITC",
    result.filedReturnInputs.table8AItcFromGstr2B ??
      "Input required",
  ]);
  worksheet.addRow([
    "Table 9 tax paid",
    result.filedReturnInputs.table9TaxPaid
      ? "Available"
      : "Input required",
  ]);

  worksheet.columns = [
    { width: 42 },
    { width: 32 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  for (let row = 9; row <= 11; row += 1) {
    worksheet.getCell(row, 2).numFmt = '#,##0.00';
  }
}

function safeFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export async function exportGstr9Excel(
  result: Gstr9Result,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Smart Accountant";
  workbook.lastModifiedBy = "Smart Accountant";
  workbook.created = new Date();
  workbook.modified = new Date();

  addSummarySheet(workbook, result);
  addOutwardSheet(workbook, result);
  addNatureSheet(workbook, result);
  addHsnSheet(workbook, result);
  addReconciliationSheet(workbook, result);
  addSourceAndValidationSheet(workbook, result);

  const buffer = await workbook.xlsx.writeBuffer();

  const blob = new Blob([buffer as ArrayBuffer], {
    type: XLSX_MIME,
  });

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  const gstin = safeFilePart(
    result.company.gstin ?? "NO-GSTIN",
  );

  anchor.href = url;
  anchor.download = `GSTR9_${gstin}_${result.period.financialYear}.xlsx`;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
}
