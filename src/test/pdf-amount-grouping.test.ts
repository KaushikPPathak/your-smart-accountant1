import { describe, expect, it } from "vitest";
import { groupPdfAmount } from "@/lib/exporters";
import { promoteRows } from "@/lib/export-format";

describe("PDF amount grouping", () => {
  it("groups crore and lakh amounts", () => {
    expect(groupPdfAmount("11500435.50")).toBe("1,15,00,435.50");
    expect(groupPdfAmount("5530291.86")).toBe("55,30,291.86");
  });
  it("leaves small and plain text unchanged", () => {
    expect(groupPdfAmount("2.37")).toBe("2.37");
    expect(groupPdfAmount("Bank Charges")).toBe("Bank Charges");
    expect(groupPdfAmount("2026")).toBe("2026");
  });
  it("handles negatives", () => {
    expect(groupPdfAmount("-100000.00")).toBe("-1,00,000.00");
  });
});

describe("Excel keeps amounts numeric", () => {
  it("promotes two-decimal money text to numbers", () => {
    const [row] = promoteRows([["Bank Charges", "11500435.50", "Total"]]) as unknown[][];
    expect(row[1]).toMatchObject({ t: "n", v: 11500435.5 });
    expect(row[0]).toBe("Bank Charges");
  });
});
