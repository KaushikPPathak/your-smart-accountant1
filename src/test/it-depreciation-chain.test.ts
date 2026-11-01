import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { addFixedAssetLocal } from "@/lib/offline/tax-audit-local";
import { loadItData, DEFAULT_IT_BLOCKS, summariseBlocks } from "@/lib/tax-audit";

const CO = "dep-co";
const FY_START = "2026-04-01";
const FY_END = "2027-03-31";

describe("IT depreciation chain (local)", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_it_fixed_assets.clear(), db.cache_it_asset_movements.clear()]);
  });

  it("an asset saved with an opening WDV shows depreciation in the block summary", async () => {
    await addFixedAssetLocal(CO, FY_START, { block_code: DEFAULT_IT_BLOCKS[3].code, name: "Machine", opening_wdv_paise: 1000000 });
    const it = await loadItData(CO, FY_START, FY_END);
    expect(it.assets).toHaveLength(1);
    const blocks = summariseBlocks(DEFAULT_IT_BLOCKS.map((b) => ({ ...b })), it.assets, it.movements, FY_START);
    const pm = blocks.find((b) => b.code === DEFAULT_IT_BLOCKS[3].code)!;
    expect(pm.opening_paise).toBe(1000000);
    expect(pm.depreciation_paise).toBeGreaterThan(0);
  });
});
