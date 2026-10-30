import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readSpreadsheet, sheetRows, writeSpreadsheet } from "./spreadsheet";
import { dateToExcelSerial, excelSerialParts } from "./excel-serial";

describe("spreadsheet round trip (ExcelJS)", () => {
  it("writes sheets and reads them back with names, values and header row intact", async () => {
    const buf = await writeSpreadsheet([
      {
        name: "Ledger",
        rows: [
          ["Date", "Narration", "Amount"],
          [{ t: "d", v: new Date(Date.UTC(2025, 3, 1)), z: "dd-mm-yyyy" }, "Opening", { t: "n", v: 1234.5, z: "#,##0.00" }],
          ["", "Null cell skipped", null],
          [{ t: "s", v: "" }, "Blank string", -99],
        ],
      },
      { name: "Second", rows: [["A"], ["x"]] },
    ]);

    const book = await readSpreadsheet(buf, { cellDates: true });
    expect(book.SheetNames).toEqual(["Ledger", "Second"]);

    const ledger = sheetRows(book.Sheets["Ledger"]);
    expect(ledger[0]).toEqual(["Date", "Narration", "Amount"]);
    expect(ledger[1][0]).toBeInstanceOf(Date);
    expect((ledger[1][0] as Date).getTime()).toBe(Date.UTC(2025, 3, 1));
    expect(ledger[1][1]).toBe("Opening");
    expect(ledger[1][2]).toBe(1234.5);
    expect(ledger[2][2]).toBeUndefined();
    expect(ledger[3][1]).toBe("Blank string");
    expect(ledger[3][2]).toBe(-99);

    expect(sheetRows(book.Sheets["Second"])).toEqual([["A"], ["x"]]);
  });

  it("returns date cells as Excel serials when cellDates is false", async () => {
    const buf = await writeSpreadsheet([
      { name: "S", rows: [[{ t: "d", v: new Date(Date.UTC(2024, 0, 15)), z: "dd/mm/yyyy" }]] },
    ]);
    const book = await readSpreadsheet(buf, { cellDates: false });
    expect(sheetRows(book.Sheets["S"])[0][0]).toBe(45306);
  });

  it("applies defval, range and blankrows like the old sheet_to_json options", async () => {
    const buf = await writeSpreadsheet([
      {
        name: "R",
        rows: [["h1", "h2"], [], ["a", null], [null, null], ["b", "c"]],
      },
    ]);
    const sheet = (await readSpreadsheet(buf)).Sheets["R"];
    expect(sheetRows(sheet, { defval: "" })[2]).toEqual(["a", ""]);
    expect(sheetRows(sheet, { range: 2, blankrows: false })).toEqual([["a", undefined], ["b", "c"]]);
  });

  it("maps formula results, rich text and merged slave cells the way raw reads expect", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Edge");
    ws.getCell("A1").value = { formula: "1+2", result: 3 };
    ws.getCell("B1").value = { richText: [{ text: "Hel" }, { text: "lo" }] };
    ws.getCell("C1").value = 7;
    ws.mergeCells("A3:C3");
    ws.getCell("A3").value = "Merged title";
    const raw = await wb.xlsx.writeBuffer();

    const sheet = (await readSpreadsheet(raw as unknown as ArrayBuffer)).Sheets["Edge"];
    const rows = sheetRows(sheet);
    expect(rows[0]).toEqual([3, "Hello", 7]);
    expect(rows[2]).toEqual(["Merged title", undefined, undefined]);
    expect(sheet.merges).toEqual([{ s: { r: 2, c: 0 }, e: { r: 2, c: 2 } }]);
  });

  it("writes the gstn header styling with a title row, filter and frozen pane", async () => {
    const header = ["GSTIN", "Invoice", "Taxable Value"];
    const buf = await writeSpreadsheet(
      [
        {
          name: "B2B",
          styling: "gstn",
          autoFilterHeaderRow: 2,
          rows: [["GSTR-1 export"], ["GSTIN: 24ABCDE1234F1Z5", "FP 102026"], header, ["24XX", "INV-1", 100]],
        },
      ],
      { styled: true },
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("B2B")!;
    expect(ws.getCell("A1").value).toBe("GSTR-1 export");
    expect(ws.getCell("A3").font?.bold).toBe(true);
    expect(ws.getCell("A3").fill).toMatchObject({ type: "pattern", fgColor: { argb: "FF305496" } });
    expect(ws.model.merges).toEqual(["A1:C1"]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    expect(ws.autoFilter).toBe("A3:C4");
  });

  it("converts Excel serials to date parts and back", () => {
    expect(excelSerialParts(45306)).toMatchObject({ y: 2024, m: 1, d: 15 });
    expect(excelSerialParts(-1)).toBeNull();
    expect(dateToExcelSerial(new Date(Date.UTC(2024, 0, 15)))).toBe(45306);
  });
});
