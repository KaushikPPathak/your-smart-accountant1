import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyseGstr2bExcelBuffer } from "./gstr2b-excel-import";

function workbookBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  const addRows = (rows: unknown[][]) => {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      "GSTR2B",
    );
  };

  addRows([
    [],
    [],
    ["", "", "", "", "NAME  :", "ZAVERI AND CO"],
    ["", "", "", "", "YEAR  :", "2025-2026"],
    ["", "", "", "", "GSTIN  :", "24AACHP4798Q1ZB"],
    [],
    [],
    ["GSTR 2B FOR YEARLY"],
    ["B2B"],
    [
      "SR NO", "INVOICE NO", "INVOICE DT", "GSTIN", "REV. CHRG", "NAME",
      "GSTR 3B FILED", "GSTR 2B PERIOD", "GSTR 1 FILLING DT", "GSTR 1 PERIOD",
      "RATE", "TAX. VAL", "IGST", "CGST", "SGST", "CESS", "VALUE",
      "SOURCE TYPE", "IS EINVOICE ENABLED", "INVOICE SUB-TYPE", "IS ECOM",
      "IS ELIGIBLE ITC", "REASON",
    ],
    [
      "1", "INV-001", new Date("2025-04-23"), "24AAAAA1111A1Z1", "N",
      "SUPPLIER ONE", "", "Apr-Jun2025", new Date("2025-05-10"), "Apr 2025",
      0, 1000, 180, 0, 0, 0, 1180, "E-Invoice", "Y", "Regular", "", "Y", "",
    ],
    [
      "2", "INV-002", new Date("2025-05-01"), "29BBBBB2222B1Z2", "N",
      "SUPPLIER TWO", "", "Apr-Jun2025", new Date("2025-06-10"), "May 2025",
      0, 2000, 0, 180, 180, 0, 2360, "", "N", "Regular", "", "Y", "",
    ],
    ["Total", "", "", "", "", "", "", "", "", "", "", 3000, 180, 180, 180, 0, 3540],
    ["B2B [FOR RCM = Y]"],
    [
      "SR NO", "INVOICE NO", "INVOICE DT", "GSTIN", "REV. CHRG", "NAME",
      "GSTR 3B FILED", "GSTR 2B PERIOD", "GSTR 1 FILLING DT", "GSTR 1 PERIOD",
      "RATE", "TAX. VAL", "IGST", "CGST", "SGST", "CESS", "VALUE",
      "SOURCE TYPE", "IS EINVOICE ENABLED", "INVOICE-SUBTYPE", "IS ECOM",
      "IS ELIGIBLE ITC", "REASON",
    ],
    [
      "1", "RCM-001", new Date("2025-12-25"), "24CCCCC3333C1Z3", "Y",
      "PORTER", "", "Oct-Dec2025", new Date("2026-01-11"), "Dec 2025",
      0, 322, 0, 8.05, 8.05, 0, 322, "", "Y", "Regular", "", "Y", "",
    ],
    ["Total", "", "", "", "", "", "", "", "", "", "", 322, 0, 8.05, 8.05, 0, 322],
    ["CDNR"],
    [
      "SR NO", "INVOICE NO", "INVOICE DT", "GSTIN", "REV. CHRG", "NAME",
      "GSTR 3B FILED", "GSTR 2B PERIOD", "GSTR 1 FILLING DT", "GSTR 1 PERIOD",
      "RATE", "TAX. VAL", "IGST", "CGST", "SGST", "CESS", "VALUE",
      "CDNR NO", "CDNR DT", "CDNR TYPE", "SOURCE TYPE", "IS EINVOICE ENABLED",
      "INVOICE SUB-TYPE", "IS ELIGIBLE ITC", "REASON",
    ],
    [
      "1", "", "", "29DDDDD4444D1Z4", "N", "AMAZON SELLER SERVICES",
      "", "Jul-Sep2025", new Date("2025-09-11"), "Aug 2025",
      0, -1318, -237.24, 0, 0, 0, -1555.24,
      "CDNR-001", new Date("2025-08-31"), "C", "E-Invoice", "Y", "Regular", "Y", "",
    ],
    ["Total", "", "", "", "", "", "", "", "", "", "", -1318, -237.24, 0, 0, 0, -1555.24],
    [],
    [],
    ["This text is not a data section and must not be imported."],
    ["docs", "document number list"],
  ]);

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}

describe("GSTR-2B yearly Excel analyser", () => {
  it("maps B2B, RCM and CDNR sections separately", async () => {
    const result = await analyseGstr2bExcelBuffer(workbookBuffer(), {
      fileName: "ZAVERI_Yearly_Summary_GSTR2B_2025-2026.xlsx",
      expectedFinancialYear: "2025-26",
      expectedGstin: "24AACHP4798Q1ZB",
    });

    expect(result.companyName).toBe("ZAVERI AND CO");
    expect(result.gstin).toBe("24AACHP4798Q1ZB");
    expect(result.financialYear).toBe("2025-26");

    expect(result.regularB2B).toHaveLength(2);
    expect(result.rcm).toHaveLength(1);
    expect(result.cdnr).toHaveLength(1);
    expect(result.lines).toHaveLength(4);

    expect(result.regularB2B[0].section).toBe("B2B");
    expect(result.regularB2B[0].invoice_no).toBe("INV-001");
    expect(result.regularB2B[0].taxable_paise).toBe(100000);
    expect(result.regularB2B[0].igst_paise).toBe(18000);

    expect(result.rcm[0].section).toBe("RCM");
    expect(result.rcm[0].rev_charge).toBe(true);
    expect(result.rcm[0].taxable_paise).toBe(32200);
    expect(result.rcm[0].cgst_paise).toBe(805);
    expect(result.rcm[0].sgst_paise).toBe(805);

    expect(result.cdnr[0].section).toBe("CDNR");
    expect(result.cdnr[0].invoice_no).toBe("");
    expect(result.cdnr[0].cdnr_no).toBe("CDNR-001");
    expect(result.cdnr[0].taxable_paise).toBe(-131800);
    expect(result.cdnr[0].igst_paise).toBe(-23724);

    expect(result.reconcilableB2B).toHaveLength(2);
    expect(result.totals.B2B.count).toBe(2);
    expect(result.totals.RCM.count).toBe(1);
    expect(result.totals.CDNR.count).toBe(1);
  });

  it("does not import TOTAL rows as invoices", async () => {
    const result = await analyseGstr2bExcelBuffer(workbookBuffer());

    expect(result.lines.every((line) => line.invoice_no !== "Total")).toBe(true);
    expect(result.regularB2B).toHaveLength(2);
    expect(result.rcm).toHaveLength(1);
    expect(result.cdnr).toHaveLength(1);
  });

  it("warns on financial-year mismatch without changing the parsed data", async () => {
    const result = await analyseGstr2bExcelBuffer(workbookBuffer(), {
      expectedFinancialYear: "2024-25",
    });

    expect(result.warnings).toContain(
      "Workbook FY 2025-26 does not match selected FY 2024-25. Nothing should be saved.",
    );
    expect(result.lines).toHaveLength(4);
  });

  it("warns on GSTIN mismatch", async () => {
    const result = await analyseGstr2bExcelBuffer(workbookBuffer(), {
      expectedGstin: "24ZZZZZ9999Z1Z9",
    });

    expect(result.warnings).toContain(
      "Workbook GSTIN 24AACHP4798Q1ZB does not match selected GSTIN 24ZZZZZ9999Z1Z9. Nothing should be saved.",
    );
  });

  it("rejects a workbook without the GSTR2B sheet", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["B2B"]]),
      "Other",
    );

    await expect(
      analyseGstr2bExcelBuffer(
        XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer,
      ),
    ).rejects.toThrow("GSTR2B sheet was not found in the workbook.");
  });
});
