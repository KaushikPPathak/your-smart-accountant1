// One sign-in for the whole computer. Created once, and it opens every company on this device.
// Stored only on this device (localStorage). Each launch asks for it once (sessionStorage).
import { b64, derive, generateRecoveryCode, normalizeCode, passwordProblem } from "@/lib/local-company-access";

const KEY = "ym_device_login";
const SESSION = "ym_device_unlocked";
const ITER = 310_000;

interface DeviceLogin {
  salt: string;
  hash: string;
  iter: number;
  recoverySalt: string;
  recoveryHash: string;
}

function read(): DeviceLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeviceLogin) : null;
  } catch {
    return null;
  }
}

function write(v: DeviceLogin): void {
  localStorage.setItem(KEY, JSON.stringify(v));
}

export function hasDeviceLogin(): boolean {
  return read() !== null;
}

export function isDeviceUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION) === "1";
  } catch {
    return false;
  }
}

export function markDeviceUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION, "1");
  } catch {
    /* in-memory state is enough for this launch */
  }
}

async function credentials(password: string, recoveryCode: string): Promise<DeviceLogin> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const recoverySalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return {
    salt,
    hash: await derive(password, salt, ITER),
    iter: ITER,
    recoverySalt,
    recoveryHash: await derive(normalizeCode(recoveryCode), recoverySalt, ITER),
  };
}

/** Creates the computer's sign-in. Returns the recovery code, which is shown once. */
export async function createDeviceLogin(password: string): Promise<string> {
  const problem = passwordProblem(password, "strict");
  if (problem) throw new Error(problem);
  const code = generateRecoveryCode();
  write(await credentials(password, code));
  markDeviceUnlocked();
  return code;
}

export async function verifyDeviceLogin(password: string): Promise<boolean> {
  const d = read();
  if (!d) return false;
  if ((await derive(password, d.salt, d.iter)) !== d.hash) return false;
  markDeviceUnlocked();
  return true;
}

/** Forgot password: the recovery code given at sign-up sets a new password and a new code. */
export async function resetDeviceLogin(recoveryAttempt: string, newPassword: string): Promise<string> {
  const d = read();
  if (!d) throw new Error("No sign-in is set up on this computer");
  if ((await derive(normalizeCode(recoveryAttempt), d.recoverySalt, d.iter)) !== d.recoveryHash) {
    throw new Error("Recovery code does not match");
  }
  const problem = passwordProblem(newPassword, "strict");
  if (problem) throw new Error(problem);
  const code = generateRecoveryCode();
  write(await credentials(newPassword, code));
  markDeviceUnlocked();
  return code;
}
