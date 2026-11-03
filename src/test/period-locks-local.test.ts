import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import {
  lockPeriodLocal,
  unlockPeriodLocal,
  isDateLockedLocal,
  findActiveLockLocal,
  listLocksLocal,
} from "@/lib/offline/period-locks-local";
import { isDateInLockedPeriod } from "@/lib/offline/frozen-guard";

const CO = "pl-local-co";
const LOCK = { companyId: CO, returnType: "GSTR1", period: "Apr-2026", periodStart: "2026-04-01", periodEnd: "2026-04-30" };

describe("local period locks", () => {
  beforeEach(async () => {
    await db.cache_period_locks.clear();
  });

  it("locks a month and blocks dates inside it, in the voucher guard too", async () => {
    await lockPeriodLocal(LOCK);
    expect((await isDateLockedLocal(CO, "2026-04-15"))?.period).toBe("Apr-2026");
    expect(await isDateLockedLocal(CO, "2026-05-01")).toBeNull();
    expect(await isDateInLockedPeriod(CO, "2026-04-15")).toBe(true);
    expect(await isDateInLockedPeriod(CO, "2026-05-01")).toBe(false);
  });

  it("locking the same period twice keeps one lock", async () => {
    const first = await lockPeriodLocal(LOCK);
    const second = await lockPeriodLocal(LOCK);
    expect(second).toBe(first);
    expect(await listLocksLocal(CO)).toHaveLength(1);
  });

  it("unlock needs a reason of at least 10 characters and then frees the dates", async () => {
    await lockPeriodLocal(LOCK);
    await expect(unlockPeriodLocal({ companyId: CO, returnType: "GSTR1", period: "Apr-2026", reason: "short" })).rejects.toThrow(/10 characters/);
    expect(await findActiveLockLocal(CO, "GSTR1", "Apr-2026")).not.toBeNull();

    await unlockPeriodLocal({ companyId: CO, returnType: "GSTR1", period: "Apr-2026", reason: "Revised GSTR-1 after credit note" });
    expect(await isDateLockedLocal(CO, "2026-04-15")).toBeNull();
    expect(await isDateInLockedPeriod(CO, "2026-04-15")).toBe(false);
  });

  it("unlocking a period that is not locked says so", async () => {
    await expect(unlockPeriodLocal({ companyId: CO, returnType: "GSTR3B", period: "May-2026", reason: "Revised return for May" })).rejects.toThrow(/not locked/);
  });
});
