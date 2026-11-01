import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import {
  addDisallowanceLocal,
  addFixedAssetLocal,
  addMovementLocal,
  listClearancesLocal,
  listDisallowancesLocal,
  listFixedAssetsLocal,
  listMovementsLocal,
  removeDisallowanceLocal,
  removeFixedAssetLocal,
  upsertClearanceLocal,
} from "@/lib/offline/tax-audit-local";

const CO = "ita-co";
const OTHER = "ita-other";
const FY_START = "2026-04-01";
const FY_END = "2027-03-31";

describe("tax audit local data", () => {
  beforeEach(async () => {
    await Promise.all([
      db.cache_it_fixed_assets.clear(),
      db.cache_it_asset_movements.clear(),
      db.cache_it_disallowances.clear(),
      db.cache_it_43b_clearances.clear(),
    ]);
  });

  it("adds assets and movements for the year and lists them back", async () => {
    const asset = await addFixedAssetLocal(CO, FY_START, { block_code: "PM_15", name: "Lathe", opening_wdv_paise: 500000 });
    await addMovementLocal(CO, FY_START, asset.id, { kind: "addition", movement_date: "2026-06-01", amount_paise: 100000 });

    const assets = await listFixedAssetsLocal(CO, FY_START);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ name: "Lathe", block_code: "PM_15", opening_wdv_paise: 500000 });

    const moves = await listMovementsLocal(CO, FY_START);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ asset_id: asset.id, kind: "addition", amount_paise: 100000 });

    // Other year and other company are not mixed in.
    expect(await listFixedAssetsLocal(CO, "2025-04-01")).toHaveLength(0);
    expect(await listFixedAssetsLocal(OTHER, FY_START)).toHaveLength(0);
  });

  it("removing an asset also removes its movements and nothing else", async () => {
    const a = await addFixedAssetLocal(CO, FY_START, { block_code: "PM_15", name: "A", opening_wdv_paise: 1 });
    const b = await addFixedAssetLocal(CO, FY_START, { block_code: "PM_15", name: "B", opening_wdv_paise: 2 });
    await addMovementLocal(CO, FY_START, a.id, { kind: "addition", movement_date: "2026-06-01", amount_paise: 10 });
    await addMovementLocal(CO, FY_START, b.id, { kind: "deletion", movement_date: "2026-07-01", amount_paise: 20 });

    await removeFixedAssetLocal(CO, a.id);

    expect((await listFixedAssetsLocal(CO, FY_START)).map((x) => x.id)).toEqual([b.id]);
    const moves = await listMovementsLocal(CO, FY_START);
    expect(moves.map((m) => m.asset_id)).toEqual([b.id]);
  });

  it("adds and removes manual disallowances for the year", async () => {
    const row = await addDisallowanceLocal(CO, FY_END, { section: "40(a)(ia)", description: "TDS short", amount_paise: 4500 });
    expect(await listDisallowancesLocal(CO, FY_END)).toHaveLength(1);
    await removeDisallowanceLocal(row.id);
    expect(await listDisallowancesLocal(CO, FY_END)).toHaveLength(0);
  });

  it("keeps one 43B clearance per ledger and year, replacing on save", async () => {
    await upsertClearanceLocal(CO, "L-gst", FY_END, { cleared_on: "2027-01-10", cleared_paise: 1000, reference: "UTR1" });
    await upsertClearanceLocal(CO, "L-gst", FY_END, { cleared_on: "2027-02-10", cleared_paise: 2500, reference: "UTR2" });

    const map = await listClearancesLocal(CO, FY_END);
    expect(map.size).toBe(1);
    expect(map.get("L-gst")).toEqual({ cleared_on: "2027-02-10", cleared_paise: 2500, reference: "UTR2" });
    expect((await listClearancesLocal(CO, "2025-03-31")).size).toBe(0);
  });
});
