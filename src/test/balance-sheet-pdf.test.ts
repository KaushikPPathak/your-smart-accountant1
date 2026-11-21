import { describe, expect, it } from "vitest";
import { reconstructPageText } from "@/lib/ocr";
import { parseTrialBalanceText } from "@/lib/statement-parse";
import fixture from "./fixtures/jash-balance-sheet-items.json";

// A Jash Enterprise balance sheet as at 31-Mar-25: two columns (Liabilities | Assets) per page.
type Item = { str: string; transform: number[]; width?: number };
const pages = fixture as Item[][];

function balanceSheetText(): string {
  return pages.map((items) => reconstructPageText(items)).join("\n");
}

describe("balance sheet PDF opening import", () => {
  it("reads the balance sheet into balanced Dr and Cr rows", () => {
    const rows = parseTrialBalanceText(balanceSheetText());
    const dr = rows.filter((r) => r.side === "Dr").reduce((s, r) => s + r.amount, 0);
    const cr = rows.filter((r) => r.side === "Cr").reduce((s, r) => s + r.amount, 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.5);
    expect(dr).toBeCloseTo(8338809.87, 1);
  });

  it("keeps the real ledgers and drops carry-forward, total and group subtotal rows", () => {
    const rows = parseTrialBalanceText(balanceSheetText());
    const names = rows.map((r) => r.account_name.toLowerCase());
    expect(names.some((n) => /carried|brought|total/.test(n))).toBe(false);
    const byName = Object.fromEntries(rows.map((r) => [r.account_name, r]));
    expect(byName["Sundry Creditors"]?.amount).toBeCloseTo(4363146.22, 2);
    expect(byName["Sundry Debtors"]?.amount).toBeCloseTo(2073055.04, 2);
    expect(byName["Closing Stock"]?.amount).toBeCloseTo(1098550, 2);
    expect(byName["Bank Accounts"]?.amount).toBeCloseTo(146915.29, 2);
    expect(byName["Profit & Loss A/c"]?.side).toBe("Dr");
  });
});
