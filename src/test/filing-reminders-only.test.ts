import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { offlineDb } from "@/lib/offline/db";
import { scanFilingDeadlines } from "@/lib/ai/anomalies";

const CID = "c-remind";
beforeEach(async () => {
  await offlineDb.cache_companies.put({ id: CID, name: "T", gstin: "24EAIPS7135C1ZP" } as any);
  await offlineDb.cache_company_settings.where("company_id").equals(CID).delete();
});

describe("notifications", () => {
  it("only return-filing deadlines are produced", async () => {
    const out = await scanFilingDeadlines(CID, new Date(2026, 9, 10));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((a) => a.category === "deadline")).toBe(true);
  });
  it("nothing when reminders are switched off", async () => {
    await offlineDb.cache_company_settings.put({ id: "s1", company_id: CID, reminders_enabled: false } as any);
    expect(await scanFilingDeadlines(CID, new Date(2026, 9, 10))).toEqual([]);
  });
});
