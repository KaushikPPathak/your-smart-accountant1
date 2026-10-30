import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "@/lib/spreadsheet";

describe("old .xls files", () => {
  it("are refused with a clear message instead of a parser error", async () => {
    const oleHeader = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readSpreadsheet(oleHeader)).rejects.toThrow(/old Excel \(\.xls\) file/);
  });
});
