import { beforeEach, describe, expect, it } from "vitest";
import { checkSqliteIntegrity, lastIntegrityResult, INTEGRITY_KEY } from "@/lib/sqlite-integrity";

describe("sqlite integrity check", () => {
  beforeEach(() => localStorage.removeItem(INTEGRITY_KEY));

  it("passes outside the desktop app and records the result", async () => {
    const res = await checkSqliteIntegrity();
    expect(res.ok).toBe(true);
    expect(lastIntegrityResult()?.ok).toBe(true);
  });

  it("reads nothing when no check has run", () => {
    expect(lastIntegrityResult()).toBeNull();
  });
});
