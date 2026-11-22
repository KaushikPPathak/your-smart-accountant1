import { describe, expect, it } from "vitest";
import { localDay, snapshotDue, snapshotFileName, sqlLiteral } from "@/lib/sqlite-snapshot";

describe("daily SQLite snapshot", () => {
  it("names one file per local day", () => {
    expect(snapshotFileName("2026-11-22")).toBe("smart_accountant-2026-11-22.db");
    expect(localDay(new Date(2026, 10, 2, 9, 5))).toBe("2026-11-02");
  });

  it("is due when none was taken today, not when one was", () => {
    const now = new Date(2026, 10, 22, 19, 0);
    expect(snapshotDue(null, now)).toBe(true);
    expect(snapshotDue("2026-11-21", now)).toBe(true);
    expect(snapshotDue("2026-11-22", now)).toBe(false);
  });

  it("quotes paths safely for SQL", () => {
    expect(sqlLiteral("C:\\Users\\O'Neil\\db.db")).toBe("'C:\\Users\\O''Neil\\db.db'");
  });

  it("is skipped outside the desktop app and never throws", async () => {
    const { takeDailySqliteSnapshot } = await import("@/lib/sqlite-snapshot");
    const r = await takeDailySqliteSnapshot();
    expect(r.status).toBe("skipped");
  });
});
