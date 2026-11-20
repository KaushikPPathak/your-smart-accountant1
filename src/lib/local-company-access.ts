// Local-only company users & passwords. Stored on this device only
// (localStorage), never sent to our servers.
//
// Passwords are salted PBKDF2-SHA256 hashes. New hashes use ITER_CURRENT rounds; hashes saved
// before that use ITER_LEGACY and are upgraded the next time the user signs in.
//
// Forgot password is answered with a one-time recovery code shown when the user is created or the
// password is reset. PAN and GSTIN are not used, because they are printed on invoices and shared
// with customers and suppliers, so they are not secrets.

export type LocalRole = "admin" | "accountant" | "viewer";
export interface LocalCompanyUser {
  id: string;
  name: string;
  role: LocalRole;
  salt: string;
  hash: string;
  /** PBKDF2 rounds used for `hash`. Missing on users created before the upgrade (ITER_LEGACY). */
  iter?: number;
  recoverySalt?: string;
  recoveryHash?: string;
}

/**
 * Password rule chosen by the company's admin.
 *  basic:  at least 4 characters.
 *  strict: at least 8 characters, with a letter and a number. This is the default.
 * Changing the rule does not re-check passwords that are already set.
 */
export type PasswordPolicy = "basic" | "strict";
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = "strict";
const POLICY_KEY = (companyId: string) => `ym_company_password_policy:${companyId}`;

export function getPasswordPolicy(companyId: string): PasswordPolicy {
  try {
    const v = localStorage.getItem(POLICY_KEY(companyId));
    return v === "basic" || v === "strict" ? v : DEFAULT_PASSWORD_POLICY;
  } catch {
    return DEFAULT_PASSWORD_POLICY;
  }
}

export function setPasswordPolicy(companyId: string, policy: PasswordPolicy): void {
  localStorage.setItem(POLICY_KEY(companyId), policy);
}

export const POLICY_HELP: Record<PasswordPolicy, string> = {
  basic: "At least 4 characters",
  strict: "At least 8 characters, with a letter and a number",
};

export const MIN_PASSWORD_LENGTH = 8;
const ITER_CURRENT = 310_000;
const ITER_LEGACY = 100_000;

const KEY = (companyId: string) => `ym_company_access:${companyId}`;
export const OWNER_NAME = "Owner";

/** Returns a message when a new password does not meet the rule, otherwise null. */
export function passwordProblem(pw: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): string | null {
  if (policy === "basic") {
    return pw.length >= 4 ? null : "Password must be at least 4 characters";
  }
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include a letter and a number";
  return null;
}

function assertPassword(companyId: string, pw: string): void {
  const problem = passwordProblem(pw, getPasswordPolicy(companyId));
  if (problem) throw new Error(problem);
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

async function derive(secret: string, salt: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return b64(bits);
}

// Recovery codes avoid look-alike characters (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** 16 random characters from CODE_ALPHABET, grouped 4-4-4-4. Rejection sampling avoids modulo bias. */
export function generateRecoveryCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < 16) {
    const buf = crypto.getRandomValues(new Uint8Array(32));
    for (const b of buf) {
      if (b < limit && out.length < 16) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

/** Recovery code as typed: case, spaces and dashes are ignored. */
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
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

/** Fresh salt, password hash and recovery code for a user. The recovery code is returned once. */
async function credentialsFor(password: string): Promise<Pick<LocalCompanyUser, "salt" | "hash" | "iter">> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt, ITER_CURRENT), iter: ITER_CURRENT };
}

async function recoveryFor(code: string): Promise<Pick<LocalCompanyUser, "recoverySalt" | "recoveryHash">> {
  const recoverySalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { recoverySalt, recoveryHash: await derive(normalizeCode(code), recoverySalt, ITER_CURRENT) };
}

export async function upsertCompanyUser(
  companyId: string,
  name: string,
  role: LocalRole,
  password: string,
): Promise<LocalCompanyUser & { recoveryCode: string }> {
  const clean = name.trim();
  if (!clean) throw new Error("Enter a user name");
  assertPassword(companyId, password);
  const list = listCompanyUsers(companyId);
  const idx = list.findIndex((u) => u.name.toLowerCase() === clean.toLowerCase());
  const recoveryCode = generateRecoveryCode();
  const user: LocalCompanyUser = {
    id: idx >= 0 ? list[idx].id : crypto.randomUUID(),
    name: idx >= 0 ? list[idx].name : clean,
    role,
    ...(await credentialsFor(password)),
    ...(await recoveryFor(recoveryCode)),
  };
  if (idx >= 0) list[idx] = user;
  else list.push(user);
  save(companyId, list);
  return { ...user, recoveryCode };
}

/** Sets a new password and issues a new recovery code (returned once). */
export async function resetUserPassword(companyId: string, userId: string, password: string): Promise<string> {
  assertPassword(companyId, password);
  const list = listCompanyUsers(companyId);
  const u = list.find((x) => x.id === userId);
  if (!u) throw new Error("User not found");
  const recoveryCode = generateRecoveryCode();
  Object.assign(u, await credentialsFor(password), await recoveryFor(recoveryCode));
  save(companyId, list);
  return recoveryCode;
}

/**
 * Forgot password: the user types the recovery code issued to them. On a match the password
 * is replaced and a new recovery code is returned (the old one stops working).
 */
export async function resetWithRecoveryCode(
  companyId: string,
  userId: string,
  recoveryAttempt: string,
  newPassword: string,
): Promise<string> {
  const list = listCompanyUsers(companyId);
  const u = list.find((x) => x.id === userId);
  if (!u) throw new Error("User not found");
  if (!u.recoverySalt || !u.recoveryHash) {
    throw new Error("This user has no recovery code. Ask an admin to reset the password from Settings.");
  }
  const attempt = await derive(normalizeCode(recoveryAttempt), u.recoverySalt, ITER_CURRENT);
  if (attempt !== u.recoveryHash) throw new Error("Recovery code does not match");
  return resetUserPassword(companyId, userId, newPassword);
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

/**
 * Checks a password. A correct password on an older hash upgrades that hash to the current
 * number of rounds, so the stronger setting applies without the user changing anything.
 */
export async function verifyCompanyUser(companyId: string, userId: string, password: string): Promise<LocalCompanyUser | null> {
  const list = listCompanyUsers(companyId);
  const u = list.find((x) => x.id === userId);
  if (!u) return null;
  const rounds = u.iter ?? ITER_LEGACY;
  if ((await derive(password, u.salt, rounds)) !== u.hash) return null;
  if (rounds < ITER_CURRENT) {
    const upgraded = await derive(password, u.salt, ITER_CURRENT);
    Object.assign(u, { hash: upgraded, iter: ITER_CURRENT });
    save(companyId, list);
    return { ...u };
  }
  return u;
}
