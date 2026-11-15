import { describe, it, expect, vi } from "vitest";

// Simulate the SQLite store never answering (slow first-run seeding on a phone).
vi.mock("@/repositories/hsnRepository", async (orig) => {
  const real = await orig<typeof import("@/repositories/hsnRepository")>();
  return { ...real, searchHsn: () => new Promise(() => {}) };
});

import { suggestHsn } from "@/services/hsnService";

describe("HSN suggestions do not wait for the local database", () => {
  it("returns built-in matches even when the SQLite search never resolves", async () => {
    const rows = await suggestHsn("rice", 15);
    expect(rows.length).toBeGreaterThan(0);
  }, 3000);
});
