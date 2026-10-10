import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyseGstr1ExcelBuffer } from "./gstr1-excel-import";

function workbookBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  const addSheet = (name: string, rows: unknown[][]) => {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      name,
    );
  };

  addSheet("b2b", [
    ["NAME  :", "TEST CO"],
    ["YEAR  :", "2025-2026"],
    ["GSTIN :", "24TESTGSTIN"],
    [],
    ["GSTIN", "INVOICE TYPE", "RCM", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    ["27AAAA", "Regular", "N", 100000, 18000, 0, 0, 0],
    ["27BBBB", "SEZWP", "N", 20000, 3600, 0, 0, 0],
    ["27CCCC", "Regular", "Y", 10000, 1800, 0, 0, 0],
  ]);

  addSheet("b2cl", [
    ["INVOICE NUMBER", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    ["1", 50000, 9000, 0, 0, 0],
  ]);

  addSheet("b2cs", [
    ["POS", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS"],
    ["24-Gujarat", 20000, 0, 1800, 1800, 0],
  ]);

  addSheet("exp", [
    ["EXPORT TYPE", "TAXABLE VALUE", "IGST", "CESS"],
    ["WPAY", 30000, 5400, 0],
    ["WOPAY", 40000, 0, 0],
  ]);

  addSheet("exemp", [
    ["DESCRIPTION", "NIL RATED SUPPLIES", "EXEMPTED(OTHER THAN NIL RATED/NON GST SUPPLY)", "NON-GST SUPPLIES"],
    ["Nil", 5000, 0, 0],
    ["Exempt", 0, 12000, 0],
    ["Non-GST", 0, 0, 3000],
  ]);

  addSheet("at", [
    ["GROSS ADVANCE RECEIVED", "IGST", "CGST", "SGST", "CESS"],
  ]);

  addSheet("atadj", [
    ["GROSS ADVANCE ADJUSTED", "IGST", "CGST", "SGST", "CESS"],
  ]);

  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  return output as ArrayBuffer;
}

describe("GSTR-1 Excel analyser", () => {
  it("maps the client-style workbook into the GSTR-9 input model", () => {
    const result = analyseGstr1ExcelBuffer(workbookBuffer(), {
      fileName: "test.xlsx",
      expectedFinancialYear: "2025-26",
    });

    expect(result.companyName).toBe("TEST CO");
    expect(result.gstin).toBe("24TESTGSTIN");
    expect(result.financialYear).toBe("2025-26");

    expect(result.table4.b2b.taxableValue).toBe(100000);
    expect(result.table4.b2b.igst).toBe(18000);

    expect(result.table4.b2cLarge.taxableValue).toBe(50000);
    expect(result.table4.b2cOther.taxableValue).toBe(20000);

    expect(result.table4.sezWithPayment.taxableValue).toBe(20000);
    expect(result.table5.suppliesOnWhichTaxPayableByRecipient.taxableValue).toBe(10000);

    expect(result.table4.exportsWithPayment.taxableValue).toBe(30000);
    expect(result.table5.exportsWithoutPayment.taxableValue).toBe(40000);

    expect(result.table5.nilRatedSupplies.taxableValue).toBe(5000);
    expect(result.table5.exemptSupplies.taxableValue).toBe(12000);
    expect(result.table5.nonGstSupplies.taxableValue).toBe(3000);

    expect(result.table4.total.taxableValue).toBe(220000);
    expect(result.table5.total.taxableValue).toBe(70000);

    expect(result.adjustments).toHaveLength(0);
    expect(result.warnings).not.toContain(
      "Workbook FY 2025-26 does not match selected FY 2025-26. Nothing was saved.",
    );
  });


  it("does not double-count the EXEMP summary rows after TOTAL", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["NAME  :", "ZAVERI AND CO"],
        ["YEAR  :", "2025-2026"],
        ["GSTIN :", "24AACHP4798Q1ZB"],
        [],
        [
          "DESCRIPTION",
          "NIL RATED SUPPLIES",
          "EXEMPTED(OTHER THAN NIL RATED/NON GST SUPPLY)",
          "NON-GST SUPPLIES",
          "FILLING PERIOD",
          "SOURCE",
        ],
        [
          "Exempted Intra-State supplies to unregistered persons",
          0,
          20900,
          0,
          "132025",
          "GSTR 1",
        ],
        [
          "Exempted Intra-State supplies to registered persons",
          0,
          25000,
          0,
          "142025",
          "GSTR 1",
        ],
        [
          "Exempted Intra-State supplies to unregistered persons",
          0,
          26400,
          0,
          "142025",
          "GSTR 1",
        ],
        [
          "Exempted Intra-State supplies to unregistered persons",
          0,
          21450,
          0,
          "152025",
          "GSTR 1",
        ],
        [
          "Exempted Intra-State supplies to unregistered persons",
          0,
          29450,
          0,
          "162026",
          "GSTR 1A",
        ],
        [],
        [],
        ["TOTAL"],
        ["Inter-State supplies to registered persons", 0, 0, 0],
        ["Intra-State supplies to registered persons", 0, 25000, 0],
        ["Inter-State supplies to unregistered persons", 0, 0, 0],
        ["Intra-State supplies to unregistered persons", 0, 98200, 0],
      ]),
      "exemp",
    );

    const result = analyseGstr1ExcelBuffer(
      XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer,
      {
        fileName: "ZAVERI_Yearly_GSTR1_2025-2026.xlsx",
        expectedFinancialYear: "2025-26",
      },
    );

    expect(result.table5.exemptSupplies.taxableValue).toBe(123200);
    expect(result.table5.nilRatedSupplies.taxableValue).toBe(0);
    expect(result.table5.nonGstSupplies.taxableValue).toBe(0);
  });

  it("does not silently treat an unknown export type as a known category", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["EXPORT TYPE", "TAXABLE VALUE", "IGST"],
        ["UNKNOWN", 10000, 0],
      ]),
      "exp",
    );

    const result = analyseGstr1ExcelBuffer(
      XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer,
    );

    expect(result.table4.exportsWithPayment.taxableValue).toBe(0);
    expect(result.table5.exportsWithoutPayment.taxableValue).toBe(0);
  });
});
