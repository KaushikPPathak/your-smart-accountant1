import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import {
  addSubgroupLocal, listSubgroupsLocal, renameSubgroupLocal, deleteSubgroupLocal,
  setOverrideLocal, listOverridesLocal, removeOverrideLocal,
} from "@/lib/offline/account-groups-local";

describe("Group Manager (local)", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_account_subgroups.clear(), db.cache_account_group_overrides.clear()]);
  });

  it("adds, lists and renames a sub-group", async () => {
    await addSubgroupLocal("co-1", "INVESTMENTS", "Mutual Funds");
    let subs = await listSubgroupsLocal("co-1");
    expect(subs.map((s) => s.name)).toEqual(["Mutual Funds"]);
    expect(subs[0].parent_group_code).toBe("INVESTMENTS");

    await renameSubgroupLocal(subs[0].id, "Equity Funds");
    subs = await listSubgroupsLocal("co-1");
    expect(subs[0].name).toBe("Equity Funds");
  });

  it("deleting a sub-group hides it (soft delete)", async () => {
    await addSubgroupLocal("co-1", "INVESTMENTS", "Shares");
    const [s] = await listSubgroupsLocal("co-1");
    await deleteSubgroupLocal(s.id);
    expect(await listSubgroupsLocal("co-1")).toHaveLength(0);
    expect(await db.cache_account_subgroups.count()).toBe(1);
  });

  it("sets, updates and removes a group label override", async () => {
    await setOverrideLocal("co-1", "SUNDRY_DEBTORS", "Trade Receivables");
    expect(await listOverridesLocal("co-1")).toEqual([{ group_code: "SUNDRY_DEBTORS", label: "Trade Receivables" }]);

    await setOverrideLocal("co-1", "SUNDRY_DEBTORS", "Receivables");
    expect(await listOverridesLocal("co-1")).toEqual([{ group_code: "SUNDRY_DEBTORS", label: "Receivables" }]);

    await removeOverrideLocal("co-1", "SUNDRY_DEBTORS");
    expect(await listOverridesLocal("co-1")).toHaveLength(0);
  });

  it("keeps each company's groups separate", async () => {
    await addSubgroupLocal("co-1", "INVESTMENTS", "A");
    await setOverrideLocal("co-1", "SUNDRY_DEBTORS", "X");
    expect(await listSubgroupsLocal("co-2")).toHaveLength(0);
    expect(await listOverridesLocal("co-2")).toHaveLength(0);
  });
});
