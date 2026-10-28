// Regression tests for the 2026-10-27 review: period locks and FY guard on the desktop save path.
import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { assertDateInOpenFy } from "@/lib/offline/voucher-executors";

const CO = "co-review-controls";
const STAMP = "2026-07-07T00:00:00.000Z";

beforeEach(async () => {
  await Promise.all([offlineDb.cache_companies.clear(), offlineDb.cache_period_locks.clear()]);
  await offlineDb.cache_companies.put({ id: CO, company_id: CO, name: "Controls Co", financial_year_start: "2026-04-01", updated_at: STAMP });
});

describe("review 2026-10-27: desktop save controls", () => {
  it("refuses a date inside an active period lock", async () => {
    await offlineDb.cache_period_locks.put({
      id: "lock-june", company_id: CO, period_start: "2026-06-01", period_end: "2026-06-30",
      is_active: true, return_type: "gstr3b", period: "2026-06", updated_at: STAMP,
    });
    await expect(assertDateInOpenFy(CO, "2026-06-15")).rejects.toThrow(/locked period/);
    await expect(assertDateInOpenFy(CO, "2026-07-15")).resolves.toBeUndefined();
  });

  it("fails closed when the company has no financial year start", async () => {
    await offlineDb.cache_companies.put({ id: CO, company_id: CO, name: "Controls Co", updated_at: STAMP });
    await expect(assertDateInOpenFy(CO, "2026-06-15")).rejects.toThrow(/financial year start/);
  });
});
