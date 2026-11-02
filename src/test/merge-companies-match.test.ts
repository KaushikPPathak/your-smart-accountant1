import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { findDuplicateCompanyGroups } from "@/lib/merge-companies";

describe("findDuplicateCompanyGroups", () => {
  beforeEach(async () => {
    await Promise.all([db.companies.clear(), db.cache_companies.clear()]);
    const rows = [
      { id: "c1", name: "Shri Montu Ramanath Das" },
      { id: "c2", name: "Shri Montu Ramanath Das 9to Deleted )" },
      { id: "c3", name: "Shaswat" },
      { id: "c4", name: "Shaswat Enterprise" },
    ];
    await db.companies.bulkPut(rows as any);
    await db.cache_companies.bulkPut(rows as any);
  });

  it("groups a company with its marked copy, but not unrelated names", async () => {
    const groups = await findDuplicateCompanyGroups();
    const ids = groups.map((g) => g.companies.map((c) => c.id).sort());
    expect(ids).toEqual([["c1", "c2"]]);
  });
});
