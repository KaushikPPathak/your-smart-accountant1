import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { saveGstr3bManualLocal, fetchInwardSummaryLocal, fetchItcReversalLocal } from "@/lib/offline/gstr3b-local";

const inward = [
  { ty: "GST" as const, inter_paise: 100000, intra_paise: 200000 },
  { ty: "NONGST" as const, inter_paise: 0, intra_paise: 5000 },
];
const reversal = [
  { ty: "RUL" as const, iamt_paise: 1000, camt_paise: 2000, samt_paise: 2000, csamt_paise: 0 },
  { ty: "OTH" as const, iamt_paise: 0, camt_paise: 0, samt_paise: 0, csamt_paise: 0 },
];

describe("GSTR-3B manual entries (local)", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_gstr3b_inward_summary.clear(), db.cache_gstr3b_itc_reversal.clear()]);
  });

  it("saves and reads back the period's manual entries", async () => {
    await saveGstr3bManualLocal("co-1", "2026-10", inward, reversal);
    const i = await fetchInwardSummaryLocal("co-1", "2026-10");
    const r = await fetchItcReversalLocal("co-1", "2026-10");
    expect(i).toHaveLength(2);
    expect(i.find((x) => x.ty === "GST")).toEqual(inward[0]);
    expect(r.find((x) => x.ty === "RUL")).toEqual(reversal[0]);
  });

  it("saving the same period again replaces the values", async () => {
    await saveGstr3bManualLocal("co-1", "2026-10", inward, reversal);
    await saveGstr3bManualLocal("co-1", "2026-10", [{ ty: "GST", inter_paise: 7, intra_paise: 8 }], []);
    const i = await fetchInwardSummaryLocal("co-1", "2026-10");
    expect(i.find((x) => x.ty === "GST")).toEqual({ ty: "GST", inter_paise: 7, intra_paise: 8 });
    expect(i).toHaveLength(2);
  });

  it("keeps companies and periods separate", async () => {
    await saveGstr3bManualLocal("co-1", "2026-10", inward, reversal);
    expect(await fetchInwardSummaryLocal("co-1", "2026-11")).toHaveLength(0);
    expect(await fetchInwardSummaryLocal("co-2", "2026-10")).toHaveLength(0);
  });
});
