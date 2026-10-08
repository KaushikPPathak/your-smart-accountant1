import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyseGstr3bExcelBuffer } from "./gstr3b-excel-import";

function workbookBuffer(options?: {
  year?: string;
  month?: string;
  gstin?: string;
}): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  const rows: unknown[][] = Array.from(
    { length: 125 },
    () => Array.from({ length: 13 }, () => ""),
  );

  rows[4][1] = "GSTIN";
  rows[4][4] = "Year";
  rows[4][7] = "Sheet Status:";
  rows[5][1] = "Legal name of the registered person";
  rows[5][4] = "Month";

  rows[4][2] = options?.gstin ?? "24TESTGSTIN";
  rows[4][5] = options?.year ?? "2025-2026";
  rows[4][8] = "VALID";
  rows[5][2] = "TEST CO";
  rows[5][5] = options?.month ?? "April";

  /*
   * GSTN GSTR-3B numeric columns start from Column C:
   *
   * C = Taxable value / tax payable
   * D = IGST
   * E = CGST
   * F = SGST
   * G = Cess
   *
   * For payment rows:
   * I = Tax paid through cash
   * J = Interest / other payment column as applicable
   *
   * Therefore the test data must start at index 2 (Column C),
   * not index 1 (Column B).
   */
  const set = (
    row: number,
    values: unknown[],
  ) => {
    for (let i = 0; i < values.length; i += 1) {
      rows[row - 1][i + 2] = values[i];
    }
  };

  // 3.1 total.
  set(16, [125000, 22500, 4500, 4500, 0]);

  // Eligible ITC: rows 31-35.
  set(31, [10000, 1800, 0, 0, 0]);
  set(32, [5000, 900, 0, 0, 0]);
  set(33, [3000, 540, 270, 270, 0]);
  set(34, [2000, 360, 0, 0, 0]);
  set(35, [50000, 4500, 2250, 2250, 0]);

  // 4(B)(1) combined reversal; importer must not invent a category.
  set(37, [1000, 100, 100, 100, 0]);

  // 4(B)(2) other reversal.
  set(38, [500, 50, 50, 50, 0]);

  // 3.1.1 non-zero to verify warning.
  set(24, [1000, 180, 0, 0, 0]);

  // Non-RCM payment rows 74-77.
  set(74, [22500, 1000, 0, 0, 0, "", 500, 10]);
  set(75, [4500, 0, 2000, 0, 0, "", 1000, 20]);
  set(76, [4500, 0, 0, 2000, 0, "", 1000, 20]);
  set(77, [0, 0, 0, 0, 0, "", 0, 0]);

  // RCM payment rows 79-82.
  set(79, [540, 0, 0, 0, 0, "", 540, 0]);
  set(80, [270, 0, 0, 0, 0, "", 270, 0]);
  set(81, [270, 0, 0, 0, 0, "", 270, 0]);
  set(82, [0, 0, 0, 0, 0, "", 0, 0]);

  // 5.1 Interest / late fee.
  set(65, [10, 20, 30, 0]);
  set(66, [1, 2, 3, 0]);

  // 3.2 total row 125.
  set(125, [9000, 900, 0, 0, 0]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "GSTR-3B");

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}

describe("GSTR-3B Excel importer", () => {
  it("maps the GSTN GSTR-3B structure into the existing GSTR-9 period model", () => {
    const result = analyseGstr3bExcelBuffer(
      workbookBuffer(),
      {
        fileName: "GSTR3B_Excel_Utility_V5.8.xlsm",
        expectedFinancialYear: "2025-26",
        expectedGstin: "24TESTGSTIN",
      },
    );

    expect(result.metadata.companyName).toBe("TEST CO");
    expect(result.metadata.gstin).toBe("24TESTGSTIN");
    expect(result.metadata.financialYear).toBe("2025-26");
    expect(result.metadata.month).toBe("April");
    expect(result.period.period).toBe("April 2025");

    expect(result.period.outwardTax.taxableValue).toBe(125000);
    expect(result.period.outwardTax.igst).toBe(22500);
    expect(result.period.outwardTax.cgst).toBe(4500);
    expect(result.period.outwardTax.sgst).toBe(4500);

    expect(result.period.itc.table4A1ImportOfGoods).toBe(1800);
    expect(result.period.itc.table4A2ImportOfServices).toBe(900);
    expect(result.period.itc.table4A3Rcm).toBe(1080);
    expect(result.period.itc.table4A4Isd).toBe(360);
    expect(result.period.itc.table4A5Other).toBe(9000);
    expect(result.period.itc.totalItcAvailed).toBe(13140);

    expect(result.period.itcReversal.rule38).toBe(0);
    expect(result.period.itcReversal.rule42).toBe(0);
    expect(result.period.itcReversal.rule43).toBe(0);
    expect(result.period.itcReversal.section17_5).toBe(0);
    expect(result.period.itcReversal.other).toBe(150);
    expect(result.period.itcReversal.total).toBe(150);

    expect(result.period.taxPaid.igst.taxPayable).toBe(23040);
    expect(result.period.taxPaid.igst.paidThroughItc).toBe(1000);
    expect(result.period.taxPaid.igst.paidThroughCash).toBe(1040);

    expect(result.period.taxPaid.cgst.taxPayable).toBe(4770);
    expect(result.period.taxPaid.cgst.paidThroughItc).toBe(2000);
    expect(result.period.taxPaid.cgst.paidThroughCash).toBe(1270);

    expect(result.period.taxPaid.sgst.taxPayable).toBe(4770);
    expect(result.period.taxPaid.sgst.paidThroughItc).toBe(2000);
    expect(result.period.taxPaid.sgst.paidThroughCash).toBe(1270);

    expect(result.period.taxPaid.interest).toBe(60);
    expect(result.period.taxPaid.lateFee).toBe(6);
    expect(result.period.taxPaid.penalty).toBe(0);
    expect(result.period.taxPaid.others).toBe(0);

    expect(result.warnings.some((w) => w.includes("3.1.1"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("4(B)(1)"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("3.2"))).toBe(true);
  });

  it("normalises a four-digit financial year to the existing GSTR-9 FY format", () => {
    const result = analyseGstr3bExcelBuffer(
      workbookBuffer({
        year: "2025-26",
        month: "April",
      }),
      { expectedFinancialYear: "2025-2026" },
    );

    expect(result.metadata.financialYear).toBe("2025-26");
    expect(result.period.period).toBe("April 2025");
  });

  it("warns on a selected FY mismatch", () => {
    const result = analyseGstr3bExcelBuffer(
      workbookBuffer({ year: "2024-2025" }),
      { expectedFinancialYear: "2025-26" },
    );

    expect(result.warnings).toContain(
      "Workbook FY 2024-25 does not match selected FY 2025-26. Nothing should be saved.",
    );
  });

  it("throws when the GSTN GSTR-3B worksheet is missing", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Not GSTR-3B"]]),
      "Sheet1",
    );

    expect(() =>
      analyseGstr3bExcelBuffer(
        XLSX.write(workbook, {
          bookType: "xlsx",
          type: "array",
        }) as ArrayBuffer,
      ),
    ).toThrow('GSTR-3B worksheet "GSTR-3B" was not found in the workbook.');
  });
});
