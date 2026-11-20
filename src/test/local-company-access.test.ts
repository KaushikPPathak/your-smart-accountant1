import { describe, it, expect, beforeEach } from "vitest";
import {
  listCompanyUsers, upsertCompanyUser, verifyCompanyUser, resetUserPassword, resetWithRecoveryCode,
  setUserRole, removeCompanyUser, clearCompanyAccess, passwordProblem, generateRecoveryCode,
} from "@/lib/local-company-access";

const C = "co-1";
// Each hash runs 310,000 PBKDF2 rounds, so these tests need more than the default 5 s.
const SLOW = 30_000;

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

/** A user saved before the upgrade: 100,000 rounds, no recovery code. */
async function legacyUser(companyId: string, name: string, password: string, id: string) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const list = listCompanyUsers(companyId);
  list.push({ id, name, role: "accountant", salt, hash: b64(bits) });
  localStorage.setItem(`ym_company_access:${companyId}`, JSON.stringify(list));
}

describe("password policy", () => {
  it("needs at least 8 characters with a letter and a number", () => {
    expect(passwordProblem("abc12")).toMatch(/at least 8/);
    expect(passwordProblem("abcdefgh")).toMatch(/letter and a number/);
    expect(passwordProblem("12345678")).toMatch(/letter and a number/);
    expect(passwordProblem("secret12")).toBeNull();
  });

  it("refuses to create a user with a weak password", async () => {
    localStorage.clear();
    await expect(upsertCompanyUser(C, "Owner", "admin", "secret1")).rejects.toThrow(/at least 8/);
  });
});

describe("local company users & passwords", () => {
  beforeEach(() => localStorage.clear());

  it("adds users, verifies the right password and rejects a wrong one", async () => {
    const a = await upsertCompanyUser(C, "Owner", "admin", "secret123");
    await upsertCompanyUser(C, "Ravi", "accountant", "ravi12345");
    expect(listCompanyUsers(C).map((u) => u.name)).toEqual(["Owner", "Ravi"]);
    expect(await verifyCompanyUser(C, a.id, "secret123")).not.toBeNull();
    expect(await verifyCompanyUser(C, a.id, "wrong1234")).toBeNull();
    expect(JSON.stringify(listCompanyUsers(C))).not.toContain("secret123");
  }, SLOW);

  it("returns a recovery code once and stores only its hash", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "pass1234");
    expect(u.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(JSON.stringify(listCompanyUsers(C))).not.toContain(u.recoveryCode.replace(/-/g, ""));
  }, SLOW);

  it("resets a password so only the new one works", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "old12345");
    await resetUserPassword(C, u.id, "new12345");
    expect(await verifyCompanyUser(C, u.id, "old12345")).toBeNull();
    expect(await verifyCompanyUser(C, u.id, "new12345")).not.toBeNull();
  }, SLOW);

  it("keeps at least one admin, removes and clears users", async () => {
    const a = await upsertCompanyUser(C, "Owner", "admin", "pass1234");
    const r = await upsertCompanyUser(C, "Ravi", "viewer", "pass2345");
    expect(() => setUserRole(C, a.id, "viewer")).toThrow();
    removeCompanyUser(C, r.id);
    expect(listCompanyUsers(C)).toHaveLength(1);
    clearCompanyAccess(C);
    expect(listCompanyUsers(C)).toHaveLength(0);
  }, SLOW);
});

describe("forgot password uses a recovery code", () => {
  beforeEach(() => localStorage.clear());

  it("the right code sets a new password and rotates the code", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "old12345");
    const next = await resetWithRecoveryCode(C, u.id, u.recoveryCode, "new12345");
    expect(await verifyCompanyUser(C, u.id, "new12345")).not.toBeNull();
    expect(next).not.toBe(u.recoveryCode);
    // The old code no longer works after it has been used.
    await expect(resetWithRecoveryCode(C, u.id, u.recoveryCode, "third123")).rejects.toThrow(/does not match/);
  }, SLOW);

  it("accepts the code typed in lower case, without dashes or spaces", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "old12345");
    const typed = u.recoveryCode.replace(/-/g, " ").toLowerCase();
    await expect(resetWithRecoveryCode(C, u.id, typed, "new12345")).resolves.toBeTypeOf("string");
  }, SLOW);

  it("a wrong code is refused and the password is unchanged", async () => {
    const u = await upsertCompanyUser(C, "Ravi", "accountant", "old12345");
    await expect(resetWithRecoveryCode(C, u.id, "AAAA-AAAA-AAAA-AAAA", "new12345")).rejects.toThrow(/does not match/);
    expect(await verifyCompanyUser(C, u.id, "old12345")).not.toBeNull();
  }, SLOW);

  it("a user saved before recovery codes existed cannot reset by code", async () => {
    await legacyUser(C, "Old", "legacy123", "old-user");
    await expect(resetWithRecoveryCode(C, "old-user", "AAAA-AAAA-AAAA-AAAA", "new12345")).rejects.toThrow(/no recovery code/);
  }, SLOW);
});

describe("hash upgrade", () => {
  beforeEach(() => localStorage.clear());

  it("a correct sign-in upgrades an older hash, and the password still works afterwards", async () => {
    await legacyUser(C, "Old", "legacy123", "old-user");
    const before = JSON.parse(localStorage.getItem(`ym_company_access:${C}`)!)[0];
    expect(before.iter).toBeUndefined();

    expect(await verifyCompanyUser(C, "old-user", "legacy123")).not.toBeNull();
    const after = JSON.parse(localStorage.getItem(`ym_company_access:${C}`)!)[0];
    expect(after.iter).toBe(310_000);
    expect(after.hash).not.toBe(before.hash);
    expect(await verifyCompanyUser(C, "old-user", "legacy123")).not.toBeNull();
  }, SLOW);

  it("recovery codes are formatted and unambiguous", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(code).not.toMatch(/[01OIL]/);
  });
});
