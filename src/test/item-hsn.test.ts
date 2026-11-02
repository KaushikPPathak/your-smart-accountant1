import { describe, expect, it } from "vitest";
import { itemHsnError } from "@/lib/inventory/item-hsn";

const UNDER = 2_00_00_000 * 100; // ₹2 crore
const OVER = 8_00_00_000 * 100; // ₹8 crore

describe("itemHsnError", () => {
  it("requires a code", () => {
    expect(itemHsnError("", UNDER)).toMatch(/required/);
    expect(itemHsnError("   ", UNDER)).toMatch(/required/);
    expect(itemHsnError(null, OVER)).toMatch(/required/);
  });

  it("accepts 4, 6 or 8 digits under ₹5 crore", () => {
    expect(itemHsnError("2710", UNDER)).toBeNull();
    expect(itemHsnError("271019", UNDER)).toBeNull();
    expect(itemHsnError("27101980", UNDER)).toBeNull();
  });

  it("requires 6 or 8 digits above ₹5 crore", () => {
    expect(itemHsnError("2710", OVER)).toMatch(/6 or 8 digits/);
    expect(itemHsnError("271019", OVER)).toBeNull();
    expect(itemHsnError("27101980", OVER)).toBeNull();
  });

  it("rejects letters and wrong lengths", () => {
    expect(itemHsnError("27A0", UNDER)).toMatch(/digits only/);
    expect(itemHsnError("271", UNDER)).toMatch(/4, 6 or 8/);
    expect(itemHsnError("27101", UNDER)).toMatch(/4, 6 or 8/);
  });

  it("accepts SAC service codes on the same rule", () => {
    expect(itemHsnError("9983", UNDER)).toBeNull();
    expect(itemHsnError("9983", OVER)).toMatch(/6 or 8 digits/);
  });
});
