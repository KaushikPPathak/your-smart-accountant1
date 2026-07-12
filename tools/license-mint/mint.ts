// Issue a license key. Run on your own PC, after `keygen.ts`.
//
// Example:
//   bun run tools/license-mint/mint.ts \
//     --name "Ramesh Traders" \
//     --email ramesh@example.com \
//     --devices 2 \
//     --plan pro \
//     --expires 2027-07-12
//
// Prints a single line — the license key — to stdout. Send it to the buyer.

import * as ed from "@noble/ed25519";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = join(HERE, "private.key");

type Plan = "basic" | "pro" | "lifetime";

interface Args {
  name: string;
  email: string;
  devices: number;
  plan: Plan;
  expires?: string;
  id?: string;
}

function parseArgs(argv: string[]): Args {
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
  const plan = (out.plan || "pro").toLowerCase() as Plan;
  if (!["basic", "pro", "lifetime"].includes(plan)) {
    throw new Error(`--plan must be basic | pro | lifetime, got "${plan}"`);
  }
  if (!out.name) throw new Error("--name is required");
  if (!out.email) throw new Error("--email is required");
  const devices = parseInt(out.devices ?? "1", 10);
  if (!Number.isFinite(devices) || devices < 1) {
    throw new Error("--devices must be a positive integer");
  }
  if (plan !== "lifetime" && !out.expires) {
    throw new Error("--expires YYYY-MM-DD is required for non-lifetime plans");
  }
  if (out.expires && !/^\d{4}-\d{2}-\d{2}$/.test(out.expires)) {
    throw new Error("--expires must be YYYY-MM-DD");
  }
  return {
    name: out.name,
    email: out.email,
    devices,
    plan,
    expires: plan === "lifetime" ? undefined : out.expires,
    id: out.id,
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

async function main() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`\nprivate.key not found at ${PRIVATE_KEY_PATH}`);
    console.error(`Run: bun run tools/license-mint/keygen.ts\n`);
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
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
