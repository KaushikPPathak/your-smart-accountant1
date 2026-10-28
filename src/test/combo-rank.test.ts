import { describe, it, expect } from "vitest";
import { rankOptions } from "@/components/vouchers/Combo";

const opts = [
  { value: "1", label: "Sharma Traders", hint: "sundry_debtor" },
  { value: "2", label: "Ram Sharma & Sons", hint: "sundry_creditor" },
  { value: "3", label: "Shah Stores", hint: "sundry_debtor" },
  { value: "4", label: "Cash", hint: "cash" },
  { value: "5", label: "Sharma Traders", hint: "sundry_creditor" },
];

describe("rankOptions", () => {
  it("returns everything for an empty query", () => {
    expect(rankOptions(opts, "  ")).toHaveLength(5);
  });
  it("only keeps items containing every typed word", () => {
    const r = rankOptions(opts, "sharma trad").map((o) => o.value);
    expect(r).toEqual(["1", "5"]);
  });
  it("ranks names that start with the text first", () => {
    const r = rankOptions(opts, "sharma").map((o) => o.value);
    expect(r[0]).toBe("1");
    expect(r).toContain("2");
  });
  it("does not show unrelated items", () => {
    expect(rankOptions(opts, "cas").map((o) => o.label)).toEqual(["Cash"]);
  });
  it("keeps duplicate names as separate entries", () => {
    expect(rankOptions(opts, "sharma traders")).toHaveLength(2);
  });
  it("matches the hint text too", () => {
    expect(rankOptions(opts, "creditor").map((o) => o.value)).toEqual(["2", "5"]);
  });
});
