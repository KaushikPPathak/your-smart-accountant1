import { describe, it, expect } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { assertDateInOpenFy } from "@/lib/offline/voucher-executors";
describe("open FY guard", () => {
  it("rejects prior-year dates while in 2026-27", async () => {
    await offlineDb.cache_companies.put({ id: "c1", name: "X", financial_year_start: "2026-04-01" } as any);
    await expect(assertDateInOpenFy("c1", "2026-03-15")).rejects.toThrow(/outside the open financial year/);
    await expect(assertDateInOpenFy("c1", "2027-04-01")).rejects.toThrow();
    await expect(assertDateInOpenFy("c1", "2026-04-01")).resolves.toBeUndefined();
    await expect(assertDateInOpenFy("c1", "2027-03-31")).resolves.toBeUndefined();
  });
});
