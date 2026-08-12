#!/usr/bin/env node
// Local smoke test: crawl every sidebar / voucher / report route, take a
// screenshot, and record console errors. Run against the running dev
// server: `bun run smoke`. Not wired into CI — that requires setting up
// auth in the workflow — but useful before each release to catch broken
// routes (empty menus, blank pages, mount-time crashes) in one pass.
//
// Requires Playwright installed locally:
//   bunx playwright install chromium

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE || "http://localhost:8080";
const OUT = ".smoke";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  // Core
  "/app",
  "/app/companies",
  "/app/ledgers",
  "/app/items",
  "/app/account-groups",
  "/app/vouchers",
  // New-voucher forms
  "/app/vouchers/new/sales",
  "/app/vouchers/new/purchase",
  "/app/vouchers/new/receipt",
  "/app/vouchers/new/payment",
  "/app/vouchers/new/journal",
  "/app/vouchers/new/credit_note",
  "/app/vouchers/new/debit_note",
  "/app/vouchers/new/delivery_note",
  "/app/vouchers/new/quotation",
  "/app/vouchers/new/sales_order",
  "/app/vouchers/new/manufacturing",
  // Reports
  "/app/reports",
  "/app/reports/day-book",
  "/app/reports/ledger",
  "/app/reports/group-ledger",
  "/app/reports/trial-balance",
  "/app/reports/trading",
  "/app/reports/profit-loss",
  "/app/reports/balance-sheet",
  "/app/reports/outstanding",
  "/app/reports/ageing",
  "/app/reports/receivables",
  "/app/reports/payables",
  "/app/reports/cash-bank",
  "/app/reports/sales-register",
  "/app/reports/purchase-register",
  "/app/reports/stock-summary",
  "/app/reports/hsn-summary",
  "/app/reports/cost-centre",
  "/app/reports/brs",
  "/app/reports/gstr1",
  "/app/reports/gstr2b",
  "/app/reports/gstr3b",
  "/app/reports/gst-sales-book",
  "/app/reports/gst-purchase-book",
  "/app/reports/itc-item-wise",
  "/app/reports/itc-party-wise",
  "/app/reports/tax-audit",
  // Housekeeping
  "/app/housekeeping",
  "/app/data-health",
  "/app/data-sync",
  "/app/bank",
  "/app/einvoice",
  "/app/assistant",
  // Settings sub-routes
  "/app/settings",
  "/app/settings/cost-centres",
  "/app/settings/tax-templates",
  "/app/settings/opening-bills",
];

const results = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let pass = 0, fail = 0;
for (const route of ROUTES) {
  consoleErrors.length = 0;
  const url = BASE + route;
  const slug = route.replace(/[/]/g, "_").replace(/^_/, "") || "root";
  const rec = { route, url, ok: true, status: 200, errors: [], screenshot: `${slug}.png` };
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    rec.status = resp?.status?.() ?? 0;
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${slug}.png`), fullPage: false });
    rec.errors = [...consoleErrors];
    rec.ok = rec.status < 400 && consoleErrors.length === 0;
  } catch (e) {
    rec.ok = false;
    rec.errors = [String(e), ...consoleErrors];
  }
  results.push(rec);
  const flag = rec.ok ? "✓" : "✗";
  console.log(`${flag} ${route}  status=${rec.status}  errors=${rec.errors.length}`);
  if (rec.ok) pass++; else fail++;
}

await browser.close();
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ pass, fail, results }, null, 2));
console.log(`\nSmoke complete: ${pass} passed, ${fail} failed. See ${OUT}/summary.json`);
process.exit(fail === 0 ? 0 : 1);
