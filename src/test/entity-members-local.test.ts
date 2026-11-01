import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import {
  addEntityMemberLocal, listEntityMembersLocal, updateEntityMemberLocal, deleteEntityMemberLocal,
} from "@/lib/offline/entity-members-local";

const base = {
  member_role: "partner", full_name: "", designation: null, pan: null, din: null, email: null, phone: null,
  share_percent: 0, profit_sharing_ratio: 0, capital_contribution_paise: 0, appointed_on: null, is_active: true,
};

describe("Entity members (local)", () => {
  beforeEach(async () => {
    await db.cache_entity_members.clear();
  });

  it("adds, updates, lists in order and removes members", async () => {
    const a = await addEntityMemberLocal("co-1", { ...base, full_name: "Asha" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await addEntityMemberLocal("co-1", { ...base, full_name: "Ravi" });

    await updateEntityMemberLocal(a.id, { share_percent: 60, capital_contribution_paise: 500000 });
    let rows = await listEntityMembersLocal("co-1");
    expect(rows.map((r) => r.full_name)).toEqual(["Asha", "Ravi"]);
    expect(rows[0].share_percent).toBe(60);

    await deleteEntityMemberLocal(b.id);
    rows = await listEntityMembersLocal("co-1");
    expect(rows.map((r) => r.full_name)).toEqual(["Asha"]);
  });

  it("keeps companies separate", async () => {
    await addEntityMemberLocal("co-1", { ...base, full_name: "Asha" });
    expect(await listEntityMembersLocal("co-2")).toHaveLength(0);
  });
});
