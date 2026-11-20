import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { setManualValuation } from "@/lib/offline/manual-valuation";
import { suggestClosingStock } from "@/lib/inventory/closing-stock";

const CO = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await offlineDb.cache_items.clear();
  await offlineDb.cache_vouchers.clear();
  await offlineDb.cache_voucher_items.clear();
  await offlineDb.cache_manual_valuations.clear();
});

describe("closing stock for the year-end close", () => {
  it("uses a manual valuation for that date when one is recorded", async () => {
    await setManualValuation(CO, "2027-03-31", 1234500);
    const s = await suggestClosingStock(CO, "2027-03-31");
    expect(s).toEqual({ paise: 1234500, source: "manual" });
  });

  it("values from the costing engine when there is no manual valuation", async () => {
    const s = await suggestClosingStock(CO, "2027-03-31");
    expect(s.source).toBe("engine");
    expect(s.paise).toBe(0); // no items, so nothing to value
  });
});
