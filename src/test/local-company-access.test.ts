import { describe, it, expect, beforeEach } from "vitest";
import {
  listCompanyUsers, upsertCompanyUser, verifyCompanyUser, resetUserPassword,
  setUserRole, removeCompanyUser, clearCompanyAccess, recoveryMatches,
} from "@/lib/local-company-access";

const C = "co-1";

describe("local company users & passwords", () => {
  beforeEach(() => localStorage.clear());

  it("adds users, verifies the right password and rejects a wrong one", async () => {
    const a = await upsertCompanyUser(C, "Owner", "admin", "secret1");
    await upsertCompanyUser(C, "Ravi", "accountant", "ravi1234");
    expect(listCompanyUsers(C).map((u) => u.name)).toEqual(["Owner", "Ravi"]);
    expect(await verifyCompanyUser(C, a.id, "secret1")).not.toBeNull();
    expect(await verifyCompanyUser(C, a.id, "wrong")).toBeNull();
    expect(JSON.stringify(listCompanyUsers(C))).not.toContain("secret1");
  });

  it("resets a password so only the new one works", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "old1");
    await resetUserPassword(C, u.id, "new1");
    expect(await verifyCompanyUser(C, u.id, "old1")).toBeNull();
    expect(await verifyCompanyUser(C, u.id, "new1")).not.toBeNull();
  });

  it("keeps at least one admin, removes and clears users", async () => {
    const a = await upsertCompanyUser(C, "Owner", "admin", "pass1");
    const r = await upsertCompanyUser(C, "Ravi", "viewer", "pass2");
    expect(() => setUserRole(C, a.id, "viewer")).toThrow();
    removeCompanyUser(C, r.id);
    expect(listCompanyUsers(C)).toHaveLength(1);
    clearCompanyAccess(C);
    expect(listCompanyUsers(C)).toHaveLength(0);
  });

  it("forgot-password check uses PAN/GSTIN, else company name", () => {
    expect(recoveryMatches("abcde1234f", { pan: "ABCDE1234F" })).toBe(true);
    expect(recoveryMatches("24ABCDE1234F1Z5", { pan: "ABCDE1234F", gstin: "24ABCDE1234F1Z5" })).toBe(true);
    expect(recoveryMatches("Zaveri & Co", { pan: "ABCDE1234F", name: "Zaveri & Co" })).toBe(false);
    expect(recoveryMatches("zaveri & co", { name: "Zaveri & Co" })).toBe(true);
  });
});
