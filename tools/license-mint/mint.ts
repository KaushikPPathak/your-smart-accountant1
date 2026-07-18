// Issue a license key. Run on your own PC, after `keygen.ts`.
//
// Two modes:
//
// 1) Interactive (just run with no args — recommended):
//      bun run tools/license-mint/mint.ts
//    You'll be prompted for name, email, plan, devices, expiry (DD-MM-YYYY),
//    then asked "Generate? (Y/N)" before the key is minted.
//
// 2) Flags (scriptable):
//      bun run tools/license-mint/mint.ts \
//        --name "Ramesh Traders" \
//        --email ramesh@example.com \
//        --devices 2 \
//        --plan pro \
//        --expires 2027-07-12          (ISO YYYY-MM-DD)
//
// Prints the license key on its own line. Send it to the buyer.

import * as ed from "@noble/ed25519";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = join(HERE, "private.key");

type Plan = "basic" | "pro" | "lifetime";

interface Args {
  name: string;
  email: string;
  devices: number;
  plan: Plan;
  expires?: string; // ISO YYYY-MM-DD
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

/** Accepts DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD. Returns ISO YYYY-MM-DD. */
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

async function promptInteractive(): Promise<Args | null> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const name = (await rl.question("Customer Name: ")).trim();
    const email = (await rl.question("Email: ")).trim();
    const planRaw = (await rl.question("Plan [pro]: ")).trim() || "pro";
    const plan = normalisePlan(planRaw);
    const devicesRaw = (await rl.question("Devices [1]: ")).trim() || "1";
    let expires: string | undefined;
    if (plan !== "lifetime") {
      const exp = (await rl.question("Expiry (DD-MM-YYYY): ")).trim();
      expires = normaliseExpiry(exp);
    }
    const args = validateArgs({ name, email, devices: devicesRaw, plan, expires });

    console.log("\n── Review ─────────────────────────────────────────────────────");
    console.log(`  Customer : ${args.name} <${args.email}>`);
    console.log(`  Plan     : ${args.plan}`);
    console.log(`  Devices  : ${args.devices}`);
    console.log(`  Expires  : ${args.expires ?? "never (lifetime)"}`);
    console.log("───────────────────────────────────────────────────────────────");
    const confirm = (await rl.question("Generate? (Y/N): ")).trim().toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      console.log("Aborted. No key generated.");
      return null;
    }
    return args;
  } finally {
    rl.close();
  }
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

async function main() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`\nprivate.key not found at ${PRIVATE_KEY_PATH}`);
    console.error(`Run: bun run tools/license-mint/keygen.ts\n`);
    process.exit(1);
  }

  const flagArgs = parseFlagArgs(process.argv.slice(2));
  let args: Args | null;

  if (Object.keys(flagArgs).length === 0) {
    // Interactive
    args = await promptInteractive();
    if (!args) return;
  } else {
    args = validateArgs(flagArgs);
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

  console.log("\n── License minted ─────────────────────────────────────────────");
  console.log(`  Customer : ${args.name} <${args.email}>`);
  console.log(`  Plan     : ${args.plan}`);
  console.log(`  Devices  : ${args.devices}`);
  console.log(`  Expires  : ${args.expires ?? "never (lifetime)"}`);
  console.log(`  ID       : ${payload.id}`);
  console.log("───────────────────────────────────────────────────────────────");
  console.log("\n" + key + "\n");
  console.log("Send the line above to the buyer. They paste it into Settings → License.\n");
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
