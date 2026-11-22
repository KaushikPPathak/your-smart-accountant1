import { beforeEach, describe, expect, it } from "vitest";
import { checkSqliteIntegrity, lastIntegrityResult, shouldShowIntegrityWarning, INTEGRITY_KEY } from "@/lib/sqlite-integrity";

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

describe("integrity warning visibility", () => {
  const failed = { ok: false, checkedAt: "2026-11-22T10:00:00.000Z", detail: "row 3 missing from index" };
  it("shows a failed result that was not dismissed", () => {
    expect(shouldShowIntegrityWarning(failed, null)).toBe(true);
  });
  it("hides it once dismissed for that check", () => {
    expect(shouldShowIntegrityWarning(failed, failed.checkedAt)).toBe(false);
  });
  it("shows again after a later failed check", () => {
    expect(shouldShowIntegrityWarning({ ...failed, checkedAt: "2026-11-23T10:00:00.000Z" }, failed.checkedAt)).toBe(true);
  });
  it("never shows a passing or missing result", () => {
    expect(shouldShowIntegrityWarning({ ...failed, ok: true }, null)).toBe(false);
    expect(shouldShowIntegrityWarning(null, null)).toBe(false);
  });
});
