// Local-only company users & passwords. Stored on this device only
// (localStorage), never sent to our servers. Passwords are salted PBKDF2 hashes.

export type LocalRole = "admin" | "accountant" | "viewer";
export interface LocalCompanyUser {
  id: string;
  name: string;
  role: LocalRole;
  salt: string;
  hash: string;
}

const KEY = (companyId: string) => `ym_company_access:${companyId}`;
export const OWNER_NAME = "Owner";

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return b64(bits);
}

export function listCompanyUsers(companyId: string): LocalCompanyUser[] {
  try {
    const raw = localStorage.getItem(KEY(companyId));
    const list = raw ? (JSON.parse(raw) as LocalCompanyUser[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(companyId: string, list: LocalCompanyUser[]) {
  localStorage.setItem(KEY(companyId), JSON.stringify(list));
}

export function hasLocalAccess(companyId: string): boolean {
  return listCompanyUsers(companyId).length > 0;
}

export async function upsertCompanyUser(
  companyId: string,
  name: string,
  role: LocalRole,
  password: string,
): Promise<LocalCompanyUser> {
  const clean = name.trim();
  if (!clean) throw new Error("Enter a user name");
  if (password.length < 4) throw new Error("Password must be at least 4 characters");
  const list = listCompanyUsers(companyId);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  const idx = list.findIndex((u) => u.name.toLowerCase() === clean.toLowerCase());
  const user: LocalCompanyUser = {
    id: idx >= 0 ? list[idx].id : crypto.randomUUID(),
    name: idx >= 0 ? list[idx].name : clean,
    role,
    salt,
    hash,
  };
  if (idx >= 0) list[idx] = user;
  else list.push(user);
  save(companyId, list);
  return user;
}

export async function resetUserPassword(companyId: string, userId: string, password: string): Promise<void> {
  if (password.length < 4) throw new Error("Password must be at least 4 characters");
  const list = listCompanyUsers(companyId);
  const u = list.find((x) => x.id === userId);
  if (!u) throw new Error("User not found");
  u.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  u.hash = await hashPassword(password, u.salt);
  save(companyId, list);
}

export function setUserRole(companyId: string, userId: string, role: LocalRole): void {
  const list = listCompanyUsers(companyId);
  const u = list.find((x) => x.id === userId);
  if (!u) return;
  if (u.role === "admin" && role !== "admin" && list.filter((x) => x.role === "admin").length === 1) {
    throw new Error("At least one admin is required");
  }
  u.role = role;
  save(companyId, list);
}

export function removeCompanyUser(companyId: string, userId: string): void {
  save(companyId, listCompanyUsers(companyId).filter((u) => u.id !== userId));
}

export function clearCompanyAccess(companyId: string): void {
  localStorage.removeItem(KEY(companyId));
}

export async function verifyCompanyUser(companyId: string, userId: string, password: string): Promise<LocalCompanyUser | null> {
  const u = listCompanyUsers(companyId).find((x) => x.id === userId);
  if (!u) return null;
  return (await hashPassword(password, u.salt)) === u.hash ? u : null;
}

/** Forgot-password check: the company's PAN or GSTIN (case-insensitive).
 *  Falls back to the exact company name when neither is recorded. */
export function recoveryMatches(
  answer: string,
  company: { pan?: string | null; gstin?: string | null; name?: string | null },
): boolean {
  const a = answer.trim().toUpperCase();
  if (!a) return false;
  const pan = (company.pan ?? "").trim().toUpperCase();
  const gstin = (company.gstin ?? "").trim().toUpperCase();
  if (pan || gstin) return a === pan || a === gstin;
  return a === (company.name ?? "").trim().toUpperCase();
}
