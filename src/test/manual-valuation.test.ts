import { describe, expect, it, beforeEach } from "vitest";
import { getDbInstance } from "@/lib/utils/sys-utils";
import {
  getManualValuation,
  setManualValuation,
  clearManualValuation,
  listManualValuations,
} from "@/lib/offline/manual-valuation";

describe("Manual stock valuation (local)", () => {
  beforeEach(async () => {
    const db = await getDbInstance();
    await db.cache_manual_valuations.clear();
  });

  it("returns null when no value is saved", async () => {
    expect(await getManualValuation("co-1", "2026-03-31")).toBeNull();
  });

  it("saves, reads back and replaces the value for one company and date", async () => {
    await setManualValuation("co-1", "2026-03-31", 324845100);
    expect(await getManualValuation("co-1", "2026-03-31")).toBe(324845100);

    await setManualValuation("co-1", "2026-03-31", 100000);
    expect(await getManualValuation("co-1", "2026-03-31")).toBe(100000);

    const rows = await listManualValuations("co-1");
    expect(rows).toHaveLength(1);
  });

  it("keeps companies and dates separate", async () => {
    await setManualValuation("co-1", "2026-03-31", 500);
    await setManualValuation("co-2", "2026-03-31", 900);
    await setManualValuation("co-1", "2025-03-31", 300);

    expect(await getManualValuation("co-1", "2026-03-31")).toBe(500);
    expect(await getManualValuation("co-2", "2026-03-31")).toBe(900);
    expect(await getManualValuation("co-1", "2025-03-31")).toBe(300);
    expect(await getManualValuation("co-2", "2025-03-31")).toBeNull();
  });

  it("clears only the chosen company and date", async () => {
    await setManualValuation("co-1", "2026-03-31", 500);
    await setManualValuation("co-2", "2026-03-31", 900);

    await clearManualValuation("co-1", "2026-03-31");

    expect(await getManualValuation("co-1", "2026-03-31")).toBeNull();
    expect(await getManualValuation("co-2", "2026-03-31")).toBe(900);
  });
});
