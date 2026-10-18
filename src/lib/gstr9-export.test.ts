import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildGstr9, type Gstr9HsnRow } from "./gstr9";
import { exportGstr9Excel } from "./gstr9-export";
import { exportGstr9GstnUtility } from "./gstr9-gstn-export";

const { saveExport } = vi.hoisted(() => ({ saveExport: vi.fn() }));
vi.mock("./desktop-save", () => ({ saveExport }));

const hsnRow = (taxableValue: number, gstRate: number): Gstr9HsnRow => ({
  hsn: "06914", description: "Material", uqc: "NOS", gstRate, quantity: 1,
  taxableValue, cgst: 5, sgst: 5, igst: 0, cess: 0, totalTax: 10, totalValue: taxableValue + 10,
});
const fixture = () => ({
  ...buildGstr9({ company: { name: "Test", gstin: "24AAAAA0000A1Z5", state_code: "24" }, financialYear: "2025-26", sales: [], creditNotes: [] }),
  hsn: [hsnRow(100, 5), hsnRow(200, 18)],
  hsnInward: [hsnRow(50, 5), hsnRow(75, 18)],
});

describe("GSTR-9 HSN exports", () => {
  it("writes consolidated outward/inward Excel rows and dynamic money totals", async () => {
    await exportGstr9Excel(fixture());
    const bytes = saveExport.mock.calls.at(-1)?.[0].contents;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    for (const [name, taxable] of [["Table 17 Outward HSN", 300], ["Table 18 Inward HSN", 125]] as const) {
      const sheet = workbook.getWorksheet(name);
      expect(sheet?.getCell("A5").value).toBe("06914");
      expect(sheet?.getCell("E5").value).toBe(taxable);
      expect(sheet?.getCell("A6").value).toBe("Total");
      expect(sheet?.getCell("E6").value).toMatchObject({ formula: "SUM(E5:E5)" });
      expect(sheet?.getCell("K6").value).toMatchObject({ formula: "SUM(K5:K5)" });
    }
  });

  it("fills both official HSN sheets, preserves required rate detail and original VBA/formulas", async () => {
    const template = await readFile("public/templates/GSTR-9 Offline Tool (v2.1).xlsm");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) }));
    try {
      await exportGstr9GstnUtility(fixture());
      const zip = await JSZip.loadAsync(saveExport.mock.calls.at(-1)?.[0].contents);
      const original = await JSZip.loadAsync(template);
      expect(await zip.file("xl/vbaProject.bin")?.async("uint8array")).toEqual(await original.file("xl/vbaProject.bin")?.async("uint8array"));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await zip.generateAsync({ type: "nodebuffer" }));
      for (const [name, taxable] of [["17 HSN Outward", 100], ["18 HSN Inward", 50]] as const) {
        const sheet = wb.getWorksheet(name);
        expect(sheet?.getCell("B6").value).toBe("06914");
        expect(sheet?.getCell("F6").value).toBe(taxable);
        expect(sheet?.getCell("H6").value).toBe(5);
        expect(sheet?.getCell("H7").value).toBe(18);
        expect(sheet?.getCell("G6").value).toBeNull(); // Unknown classification stays unknown.
      }
      expect(wb.getWorksheet("4 Outward")?.getCell("F15").value).toMatchObject({ formula: "SUM(F7:F14)" });
      expect(wb.getWorksheet("4 Outward")?.getCell("F21").value).toMatchObject({ formula: "F15+F20" });
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30000);
});