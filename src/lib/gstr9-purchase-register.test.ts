import { describe, expect, it } from "vitest";
import { writeSpreadsheet, type SheetCell, type WriteSheet } from "./spreadsheet";
import { parseGstr9PurchaseRegisterExcel, parseGstr9PurchaseRegisterJson } from "./gstr9-purchase-register";

describe("GSTR-9 Purchase Register import", () => {
  it("parses JSON without creating accounting vouchers", async () => {
    const result = parseGstr9PurchaseRegisterJson(JSON.stringify({
      purchases: [{
        "Supplier Name": "ABC Traders",
        "GSTIN": "24AAAAA1111A1Z1",
        "Invoice No": "INV-1",
        "Invoice Date": "2025-04-10",
        "Taxable Value": 1000,
        "IGST": 180,
        "CGST": 0,
        "SGST": 0,
        "Cess": 0,
        "Invoice Value": 1180,
      }],
    }));

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].invoiceNo).toBe("INV-1");
    expect(result.totals.taxableValue).toBe(1000);
    expect(result.totals.igst).toBe(180);
  });

  it("parses Excel rows and derives total when total column is absent", async () => {
    const wb: WriteSheet[] = [];
    const ws = ([
      ["Supplier Name", "GSTIN", "Invoice No", "Invoice Date", "Taxable Value", "IGST", "CGST", "SGST", "Cess"],
      ["ABC Traders", "24AAAAA1111A1Z1", "INV-2", "2025-05-10", 2000, 0, 180, 180, 0],
    ]);
    wb.push({ name: "Purchase Register", rows: ws });
    const buffer = await writeSpreadsheet(wb);

    const result = await parseGstr9PurchaseRegisterExcel(buffer);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].totalValue).toBe(2360);
    expect(result.totals.cgst).toBe(180);
    expect(result.totals.sgst).toBe(180);
  });

  it("rejects files without invoice and taxable columns", async () => {
    expect(() => parseGstr9PurchaseRegisterJson(JSON.stringify([{ Party: "ABC" }]))).toThrow(/Invoice No and Taxable Value/);
  });
});
