import { describe, it, expect } from "vitest";
import { rankOptions } from "@/components/vouchers/Combo";

describe("item picker search by HSN code", () => {
  const items = [
    { value: "1", label: "Basmati Rice 5kg", hint: "BAG", search: "1006" },
    { value: "2", label: "Wheat Flour", hint: "KG", search: "1101" },
    { value: "3", label: "Steel Bolt", hint: "NOS", search: "7318" },
  ];

  it("finds an item by typing its HSN code", () => {
    expect(rankOptions(items, "1006").map((o) => o.value)).toEqual(["1"]);
  });

  it("still matches by name and does not show unrelated items", () => {
    expect(rankOptions(items, "wheat").map((o) => o.value)).toEqual(["2"]);
  });

  it("keeps the unfiltered list for an empty query", () => {
    expect(rankOptions(items, "  ").length).toBe(3);
  });
});
