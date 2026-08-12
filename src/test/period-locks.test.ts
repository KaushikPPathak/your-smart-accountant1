import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from() { throw new Error("DB call not expected in this test"); },
    rpc() { throw new Error("RPC not expected in this test"); },
  },
}));

import { unlockPeriod, isPeriodLockError } from "@/lib/period-locks";

describe("unlockPeriod reason gate", () => {
  it("rejects an empty reason before any DB call", async () => {
    await expect(unlockPeriod({
      companyId: "c1", returnType: "GSTR1", period: "2026-04", reason: "",
    })).rejects.toThrow(/at least 10 characters/);
  });

  it("rejects a too-short reason", async () => {
    await expect(unlockPeriod({
      companyId: "c1", returnType: "GSTR1", period: "2026-04", reason: "typo fix",
    })).rejects.toThrow(/at least 10 characters/);
  });

  it("trims whitespace before counting", async () => {
    await expect(unlockPeriod({
      companyId: "c1", returnType: "GSTR1", period: "2026-04", reason: "        short  ",
    })).rejects.toThrow(/at least 10 characters/);
  });
});

describe("isPeriodLockError", () => {
  it("recognises trigger messages case-insensitively", () => {
    expect(isPeriodLockError(new Error("Period is locked for this return"))).toBe(true);
    expect(isPeriodLockError({ message: "period IS LOCKED" })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isPeriodLockError(new Error("unique constraint violation"))).toBe(false);
    expect(isPeriodLockError(null)).toBe(false);
    expect(isPeriodLockError(undefined)).toBe(false);
  });
});
