// Round 2 hardening — fingerprint, settings guard, intraday snapshots.

import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup, type CompanyBackup } from "@/lib/backup";
import { isBackupSafeSuperset } from "@/lib/auto-restore";
import {
  saveIntradaySnapshot,
  listIntradaySnapshots,
  restoreIntradaySnapshot,
  clearIntradayRing,
  INTRADAY_RING_SIZE,
} from "@/lib/intraday-snapshot";

const COMPANY = "co-round2";
const now = () => new Date().toISOString();

async function wipe(): Promise<void> {
  await Promise.all([
    offlineDb.cache_companies.clear(),
    offlineDb.cache_company_settings.clear(),
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_items.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.cache_voucher_items.clear(),
    offlineDb.meta.clear(),
  ]);
}

async function seedBasic(): Promise<void> {
  await offlineDb.cache_companies.put({ id: COMPANY, name: "Round2 Traders", updated_at: now() });
  await offlineDb.cache_ledgers.put({ id: "led-cash", name: "Cash", group_name: "Cash-in-Hand", company_id: COMPANY, updated_at: now() });
  await offlineDb.cache_items.put({ id: "itm-1", name: "Widget", unit: "PCS", hsn: "8471", company_id: COMPANY, updated_at: now() });
}

describe("Fingerprint hardening — isBackupSafeSuperset", () => {
  it("rejects a candidate that shares [date,type,number,total] but has a different party", () => {
    const live: CompanyBackup = {
      schema_version: 2, exported_at: now(),
      company: { id: COMPANY, name: "X" }, settings: null,
      ledgers: [{ name: "Cash", group_name: "Cash-in-Hand" }, { name: "Sales", group_name: "Sales" }],
      items: [], vouchers: [
        { voucher_date: "2026-07-01", voucher_type: "receipt", voucher_number: "1", total_amount: 1000, party_name: "Alice", narration: "" },
      ],
      voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: [],
    };
    // Candidate is BIGGER but replaces the Alice receipt with Bob's — the
    // old shape-only fingerprint would have accepted this and lost Alice.
    const candidate: CompanyBackup = {
      ...live,
      vouchers: [
        { voucher_date: "2026-07-01", voucher_type: "receipt", voucher_number: "1", total_amount: 1000, party_name: "Bob", narration: "" },
        { voucher_date: "2026-07-02", voucher_type: "receipt", voucher_number: "2", total_amount: 500, party_name: "Alice", narration: "" },
      ],
    };
    expect(isBackupSafeSuperset(candidate, live)).toBe(false);
  });

  it("accepts a candidate that truly contains every live voucher and adds more", () => {
    const rows = [
      { voucher_date: "2026-07-01", voucher_type: "receipt", voucher_number: "1", total_amount: 1000, party_name: "Alice", narration: "cash rcpt" },
    ];
    const live: CompanyBackup = {
      schema_version: 2, exported_at: now(),
      company: { id: COMPANY, name: "X" }, settings: null,
      ledgers: [{ name: "Cash", group_name: "Cash-in-Hand" }],
      items: [], vouchers: rows,
      voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: [],
    };
    const candidate: CompanyBackup = {
      ...live,
      vouchers: [
        ...rows,
        { voucher_date: "2026-07-05", voucher_type: "receipt", voucher_number: "2", total_amount: 200, party_name: "Bob", narration: "" },
      ],
    };
    expect(isBackupSafeSuperset(candidate, live)).toBe(true);
  });

  it("rejects a candidate that loses voucher_entries (child-table hardening)", () => {
    const vouchers = [{ voucher_date: "2026-07-01", voucher_type: "journal", voucher_number: "1", total_amount: 500, party_name: "", narration: "" }];
    const live: CompanyBackup = {
      schema_version: 2, exported_at: now(),
      company: { id: COMPANY, name: "X" }, settings: null,
      ledgers: [{ name: "Cash", group_name: "Cash-in-Hand" }], items: [], vouchers,
      voucher_entries: [
        { voucher_id: "v1", ledger_id: "led-cash", entry_type: "Dr", amount: 500 },
        { voucher_id: "v1", ledger_id: "led-sales", entry_type: "Cr", amount: 500 },
      ],
      voucher_items: [], bill_allocations: [], recurring_invoices: [],
    };
    const candidate: CompanyBackup = {
      ...live,
      vouchers: [...vouchers, { voucher_date: "2026-07-02", voucher_type: "receipt", voucher_number: "9", total_amount: 100, party_name: "N", narration: "" }],
      // Same vouchers count grew, but child entries were LOST — must reject.
      voucher_entries: [{ voucher_id: "v1", ledger_id: "led-cash", entry_type: "Dr", amount: 500 }],
    };
    expect(isBackupSafeSuperset(candidate, live)).toBe(false);
  });
});

describe("Settings guard — restore keeps newer local settings", () => {
  beforeEach(async () => { await wipe(); await seedBasic(); });

  it("does not silently revert freshly-edited local company_settings", async () => {
    // Local settings updated NOW (user just tweaked invoice prefix).
    await offlineDb.cache_company_settings.put({
      id: `settings-${COMPANY}`,
      company_id: COMPANY,
      invoice_prefix: "NEW-",
      updated_at: new Date(Date.now()).toISOString(),
    });
    // Backup carries an OLDER settings row that would revert the prefix.
    const backup: CompanyBackup = {
      schema_version: 2,
      exported_at: now(),
      company: { id: COMPANY, name: "Round2 Traders" },
      settings: {
        id: `settings-${COMPANY}`,
        company_id: COMPANY,
        invoice_prefix: "OLD-",
        updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
      ledgers: [], items: [], vouchers: [],
      voucher_entries: [], voucher_items: [], bill_allocations: [], recurring_invoices: [],
    };
    await restoreCompanyBackup(COMPANY, backup);
    const rows = await offlineDb.cache_company_settings.where("company_id").equals(COMPANY).toArray();
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>).invoice_prefix).toBe("NEW-");
  });

  it("does apply backup settings when local is older (or missing)", async () => {
    // No local settings row at all.
    const backup: CompanyBackup = {
      schema_version: 2, exported_at: now(),
      company: { id: COMPANY, name: "Round2 Traders" },
      settings: {
        id: `settings-${COMPANY}`, company_id: COMPANY,
        invoice_prefix: "FROM-BACKUP", updated_at: now(),
      },
      ledgers: [], items: [], vouchers: [],
      voucher_entries: [], voucher_items: [], bill_allocations: [], recurring_invoices: [],
    };
    await restoreCompanyBackup(COMPANY, backup);
    const rows = await offlineDb.cache_company_settings.where("company_id").equals(COMPANY).toArray();
    expect((rows[0] as Record<string, unknown>).invoice_prefix).toBe("FROM-BACKUP");
  });
});

describe("Intraday snapshot ring", () => {
  beforeEach(async () => { await wipe(); await seedBasic(); await clearIntradayRing(COMPANY); });

  it("captures manual snapshot and restores from it", async () => {
    const r1 = await saveIntradaySnapshot(COMPANY, "manual");
    expect(r1.saved).toBe(true);
    const list = await listIntradaySnapshots(COMPANY);
    expect(list).toHaveLength(1);
    expect(list[0].ledgers).toBe(1);

    // Now nuke ledgers, then restore.
    await offlineDb.cache_ledgers.clear();
    await restoreIntradaySnapshot(COMPANY, list[0].createdAt);
    const restored = await offlineDb.cache_ledgers.where("company_id").equals(COMPANY).count();
    expect(restored).toBe(1);
  });

  it("caps the ring at INTRADAY_RING_SIZE", async () => {
    for (let i = 0; i < INTRADAY_RING_SIZE + 3; i++) {
      await saveIntradaySnapshot(COMPANY, "manual"); // manual bypasses the min-interval guard
    }
    const list = await listIntradaySnapshots(COMPANY);
    expect(list.length).toBe(INTRADAY_RING_SIZE);
  });

  it("hourly reason is throttled by INTRADAY_MIN_INTERVAL_MS", async () => {
    const r1 = await saveIntradaySnapshot(COMPANY, "hourly");
    expect(r1.saved).toBe(true);
    const r2 = await saveIntradaySnapshot(COMPANY, "hourly");
    expect(r2.saved).toBe(false);
    expect(r2.reason).toBe("too-soon");
  });
});
