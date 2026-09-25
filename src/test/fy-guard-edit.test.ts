import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { assertDateInOpenFy } from "@/lib/offline/voucher-executors";

// Edit-path FY guard: when an existing voucher is saved, the (possibly
// edited) date must fall inside the active FY 2026-27. Historical vouchers
// are left untouched unless the user saves an invalid edited date.
describe("open FY guard on voucher edit", () => {
  beforeEach(async () => {
    await offlineDb.cache_companies.clear();
    await offlineDb.cache_companies.put({ id: "c1", name: "X", financial_year_start: "2026-04-01" } as any);
  });

  it("allows saving an edit with a valid in-FY date", async () => {
    await expect(assertDateInOpenFy("c1", "2026-04-01")).resolves.toBeUndefined();
    await expect(assertDateInOpenFy("c1", "2026-12-15")).resolves.toBeUndefined();
    await expect(assertDateInOpenFy("c1", "2027-03-31")).resolves.toBeUndefined();
  });

  it("rejects saving an edit with a previous-FY date", async () => {
    await expect(assertDateInOpenFy("c1", "2026-03-31")).rejects.toThrow(/outside the open financial year/);
    await expect(assertDateInOpenFy("c1", "2025-06-10")).rejects.toThrow(/outside the open financial year/);
  });

  it("rejects saving an edit with a next-FY date", async () => {
    await expect(assertDateInOpenFy("c1", "2027-04-01")).rejects.toThrow(/outside the open financial year/);
    await expect(assertDateInOpenFy("c1", "2028-01-01")).rejects.toThrow(/outside the open financial year/);
  });
});
