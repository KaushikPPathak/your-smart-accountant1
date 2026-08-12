// Issue a license key. Run on your own PC, after `keygen.ts`.
//
// Two modes:
//
// 1) Interactive (recommended):
//      bun run tools/license-mint/mint.ts
//
// 2) Flags (scriptable):
//      bun run tools/license-mint/mint.ts \
//        --name "Ramesh Traders" \
//        --email ramesh@example.com \
//        --devices 2 \
//        --plan pro \
//        --expires 2027-07-12
//
// Every minted license is archived under tools/license-mint/licenses/
// as both a JSON record and a human-readable .txt backup.
// The license key is also copied to the Windows clipboard when available.

import * as ed from "@noble/ed25519";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = join(HERE, "private.key");
const LICENSES_DIR = join(HERE, "licenses");

// ── Colors ─────────────────────────────────────────────────────────────────
const useColor = stdout.isTTY;
const c = {
  reset: useColor ? "\x1b[0m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  red: useColor ? "\x1b[31m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  bold: useColor ? "\x1b[1m" : "",
};
const ok = (s: string) => console.log(`${c.green}${s}${c.reset}`);
const warn = (s: string) => console.log(`${c.yellow}${s}${c.reset}`);
const err = (s: string) => console.error(`${c.red}${s}${c.reset}`);
const info = (s: string) => console.log(`${c.cyan}${s}${c.reset}`);

type Plan = "basic" | "pro" | "lifetime";

interface Args {
  name: string;
  email: string;
  devices: number;
  plan: Plan;
  expires?: string;
  id?: string;
}

function parseFlagArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) throw new Error(`--${key} requires a value`);
      out[key] = val;
      i++;
    }
  }
  return out;
}

function normalisePlan(p: string): Plan {
  const plan = p.trim().toLowerCase() as Plan;
  if (!["basic", "pro", "lifetime"].includes(plan)) {
    throw new Error(`plan must be basic | pro | lifetime, got "${p}"`);
  }
  return plan;
}

function normaliseExpiry(input: string): string {
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (!dmy) throw new Error(`expiry must be DD-MM-YYYY (or YYYY-MM-DD), got "${input}"`);
  const d = dmy[1].padStart(2, "0");
  const m = dmy[2].padStart(2, "0");
  const y = dmy[3];
  const dn = Number(d);
  const mn = Number(m);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) throw new Error(`invalid date "${input}"`);
  return `${y}-${m}-${d}`;
}

function validateArgs(raw: {
  name?: string;
  email?: string;
  devices?: string | number;
  plan?: string;
  expires?: string;
  id?: string;
}): Args {
  if (!raw.name || !String(raw.name).trim()) throw new Error("name is required");
  if (!raw.email || !String(raw.email).trim()) throw new Error("email is required");
  const plan = normalisePlan(String(raw.plan ?? "pro"));
  const devices = typeof raw.devices === "number" ? raw.devices : parseInt(String(raw.devices ?? "1"), 10);
  if (!Number.isFinite(devices) || devices < 1) throw new Error("devices must be a positive integer");
  let expires: string | undefined;
  if (plan !== "lifetime") {
    if (!raw.expires) throw new Error("expiry is required for non-lifetime plans");
    expires = normaliseExpiry(String(raw.expires));
  }
  return {
    name: String(raw.name).trim(),
    email: String(raw.email).trim(),
    devices,
    plan,
    expires,
    id: raw.id,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function newLicenseId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `L-${stamp}-${rand}`;
}

function slugify(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "customer";
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function uniqueFilePath(dir: string, base: string, ext: string): string {
  let candidate = join(dir, `${base}${ext}`);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}_${n}${ext}`);
    n++;
  }
  return candidate;
}

function findDuplicate(args: Args): string | null {
  if (!existsSync(LICENSES_DIR)) return null;
  const files = readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const rec = JSON.parse(readFileSync(join(LICENSES_DIR, f), "utf8"));
      if (
        String(rec.customerName ?? "").trim().toLowerCase() === args.name.toLowerCase() &&
        String(rec.email ?? "").trim().toLowerCase() === args.email.toLowerCase() &&
        String(rec.plan ?? "").toLowerCase() === args.plan &&
        String(rec.expiry ?? "") === (args.expires ?? "")
      ) {
        return f;
      }
    } catch {
      // ignore corrupt file
    }
  }
  return null;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const cmd = isWin ? "clip" : isMac ? "pbcopy" : "xclip";
  const args = isWin ? [] : isMac ? [] : ["-selection", "clipboard"];
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
      p.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

async function promptInteractive(): Promise<Args | null> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    info("── New License ─────────────────────────────────────────────");
    const name = (await rl.question("Customer Name : ")).trim();
    const email = (await rl.question("Email         : ")).trim();
    const planRaw = (await rl.question("Plan [pro]    : ")).trim() || "pro";
    const plan = normalisePlan(planRaw);
    const devicesRaw = (await rl.question("Devices [1]   : ")).trim() || "1";
    let expires: string | undefined;
    if (plan !== "lifetime") {
      const exp = (await rl.question("Expiry (DD-MM-YYYY): ")).trim();
      expires = normaliseExpiry(exp);
    }
    const args = validateArgs({ name, email, devices: devicesRaw, plan, expires });

    // Duplicate check
    const dup = findDuplicate(args);
    if (dup) {
      warn(`\nA license already exists for this customer (${dup}).`);
      const again = (await rl.question("Generate another one anyway? (Y/N): ")).trim().toLowerCase();
      if (again !== "y" && again !== "yes") {
        info("Aborted. No key generated.");
        return null;
      }
    }

    console.log("\n----------------------------------------");
    console.log(`Customer : ${args.name}`);
    console.log(`Email    : ${args.email}`);
    console.log(`Plan     : ${args.plan}`);
    console.log(`Devices  : ${args.devices}`);
    console.log(`Expiry   : ${args.expires ?? "never (lifetime)"}`);
    console.log("");
    const confirm = (await rl.question("Generate License? (Y/N): ")).trim().toLowerCase();
    console.log("----------------------------------------");
    if (confirm !== "y" && confirm !== "yes") {
      info("Aborted. No key generated.");
      return null;
    }
    return args;
  } finally {
    rl.close();
  }
}

async function main() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    err(`\nprivate.key not found at ${PRIVATE_KEY_PATH}`);
    err(`Run: bun run tools/license-mint/keygen.ts\n`);
    process.exit(1);
  }

  const flagArgs = parseFlagArgs(process.argv.slice(2));
  let args: Args | null;

  if (Object.keys(flagArgs).length === 0) {
    args = await promptInteractive();
    if (!args) return;
  } else {
    args = validateArgs(flagArgs);
    const dup = findDuplicate(args);
    if (dup) warn(`Warning: a license already exists for this customer (${dup}). Proceeding (flag mode).`);
  }

  const priv = hexToBytes(readFileSync(PRIVATE_KEY_PATH, "utf8"));

  const payload: Record<string, unknown> = {
    n: args.name,
    e: args.email,
    d: args.devices,
    p: args.plan,
    id: args.id ?? newLicenseId(),
  };
  if (args.expires) payload.x = args.expires;

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = bytesToB64Url(new TextEncoder().encode(payloadJson));
  const sig = await ed.signAsync(new TextEncoder().encode(payloadB64), priv);
  const sigB64 = bytesToB64Url(sig);

  const prefix = "SMAC-" + args.plan.toUpperCase();
  const key = `${prefix}-${payloadB64}.${sigB64}`;

  // Archive
  if (!existsSync(LICENSES_DIR)) mkdirSync(LICENSES_DIR, { recursive: true });
  const base = `${slugify(args.name)}_${todayIso()}`;
  const jsonPath = uniqueFilePath(LICENSES_DIR, base, ".json");
  const txtBase = jsonPath.replace(/\.json$/, "");
  const txtPath = `${txtBase}.txt`;

  const record = {
    customerName: args.name,
    email: args.email,
    plan: args.plan,
    devices: args.devices,
    expiry: args.expires ?? "",
    generatedAt: nowStamp(),
    license: key,
  };
  writeFileSync(jsonPath, JSON.stringify(record, null, 2), "utf8");

  const txt = [
    "Smart Accountant License",
    "",
    "Customer:",
    args.name,
    "",
    "Email:",
    args.email,
    "",
    "Plan:",
    args.plan.toUpperCase(),
    "",
    "Devices:",
    String(args.devices),
    "",
    "Expiry:",
    args.expires ?? "never (lifetime)",
    "",
    "Generated:",
    record.generatedAt,
    "",
    "License:",
    "",
    key,
    "",
  ].join("\n");
  writeFileSync(txtPath, txt, "utf8");

  // Clipboard
  const clipOk = await copyToClipboard(key);

  // Output
  console.log("");
  ok("========================================");
  ok("LICENSE GENERATED SUCCESSFULLY");
  console.log("");
  console.log(`Customer : ${args.name}`);
  console.log(`License  : ${key}`);
  console.log("");
  ok("========================================");
  console.log("");
  info(`Archived : ${jsonPath}`);
  info(`Backup   : ${txtPath}`);
  if (clipOk) ok("✓ License copied to clipboard.");
  else warn("Clipboard unavailable — copy the key above manually.");
  console.log("");
}

main().catch((e) => {
  err(`\nError: ${String(e?.message ?? e)}\n`);
  process.exit(1);
});
