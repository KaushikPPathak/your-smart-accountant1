import { describe, it, expect } from "vitest";
import { pickCapitalLedger, narrationLooksLikeClosure } from "@/lib/year-end-state";

const L = (id: string, name: string) => ({ id, name });

describe("pickCapitalLedger", () => {
  it("never picks a drawings or withdrawal ledger for the profit transfer", () => {
    const r = pickCapitalLedger([L("w", "Withdrawal Account"), L("d", "Drawings"), L("c", "Capital A/c")]);
    expect(r?.id).toBe("c");
  });
  it("returns null when only drawings exist, so the caller creates Capital A/c", () => {
    expect(pickCapitalLedger([L("w", "Withdrawal Account")])).toBeNull();
  });
  it("ignores reserve and profit & loss ledgers", () => {
    expect(pickCapitalLedger([L("r", "Reserves & Surplus"), L("p", "Profit & Loss A/c")])).toBeNull();
  });
});

describe("narrationLooksLikeClosure", () => {
  it("recognises closing journals we post", () => {
    expect(narrationLooksLikeClosure("Net Profit for FY 2025-04-01 to 2026-03-31 transferred to Capital A/c.")).toBe(true);
    expect(narrationLooksLikeClosure("Rent received")).toBe(false);
  });
});
