import { describe, expect, it } from "vitest";
import { ledgerTypeMismatches } from "@/lib/ledger-type-check";

const L = (id: string, name: string, type: string) => ({ id, name, type });

describe("ledger type rules (7.2)", () => {
  it("accepts GST output as a duties & taxes liability", () => {
    expect(ledgerTypeMismatches([L("1", "Output CGST", "duties_taxes")])).toEqual([]);
  });
  it("flags GST output booked as income", () => {
    const out = ledgerTypeMismatches([L("1", "Output CGST", "income_direct")]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe("GST output");
  });
  it("accepts ITC as duties & taxes or current asset, not as income", () => {
    expect(ledgerTypeMismatches([L("2", "Input SGST", "current_asset")])).toEqual([]);
    expect(ledgerTypeMismatches([L("2", "Input SGST", "income_indirect")])).toHaveLength(1);
  });
  it("flags round-off booked to a tax ledger", () => {
    expect(ledgerTypeMismatches([L("3", "Round Off", "duties_taxes")])).toHaveLength(1);
    expect(ledgerTypeMismatches([L("3", "Round Off", "expense_indirect")])).toEqual([]);
  });
  it("always flags a suspense ledger", () => {
    expect(ledgerTypeMismatches([L("4", "Suspense A/c", "current_asset")])).toHaveLength(1);
  });
  it("never flags a name that matches no rule", () => {
    expect(ledgerTypeMismatches([L("5", "Rent", "expense_indirect"), L("6", "Stuti Supplier", "sundry_creditor")])).toEqual([]);
  });
});
