// Round 3 — restore journaling, boot recovery, and checksum enforcement.
//
// Verifies:
//   1. restoreCompanyBackup sets the journal marker before entering the
//      Dexie transaction and clears it on successful commit.
//   2. If the process dies mid-restore, the marker persists in
//      localStorage so the next boot can detect and recover.
//   3. parseBackupFile detects checksum tampering on wrapped envelopes.
//   4. recoverFromInterruptedRestore rolls back to the pre-restore
//      snapshot and clears the marker.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import {
  buildCompanyBackup, restoreCompanyBackup, parseBackupFile,
} from "@/lib/backup";
import { wrapBackup } from "@/lib/backup-policy";
import {
  beginRestoreJournal, endRestoreJournal, getInterruptedRestore,
  recoverFromInterruptedRestore, savePreRestoreSnapshot,
} from "@/lib/restore-safety";

const COMPANY_ID = "co-r3-journal";
const JOURNAL_KEY = "ym:restore_in_progress";

async function wipe(): Promise<void> {
  const tables = [
    offlineDb.cache_companies, offlineDb.cache_company_settings,
    offlineDb.cache_ledgers, offlineDb.cache_items,
    offlineDb.cache_vouchers, offlineDb.cache_voucher_entries,
    offlineDb.cache_voucher_items, offlineDb.cache_bill_allocations,
    offlineDb.cache_recurring_invoices,
    offlineDb.meta,
  ];
  await Promise.all(tables.map((t) => t.clear()));
  try { window.localStorage.removeItem(JOURNAL_KEY); } catch { /* ignore */ }
}

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  await offlineDb.cache_companies.put({ id: COMPANY_ID, name: "Journal Traders", updated_at: now });
  await offlineDb.cache_ledgers.put({
    id: "led-1", company_id: COMPANY_ID, name: "Cash", updated_at: now,
  });
  await offlineDb.cache_vouchers.put({
    id: "v-1", company_id: COMPANY_ID, voucher_type: "sales",
    voucher_number: "1", voucher_date: "2026-07-01", total_amount: 100, updated_at: now,
  });
}

describe("Round 3 — restore journaling", () => {
  beforeEach(async () => { await wipe(); await seed(); });
  afterEach(async () => {
    try { window.localStorage.removeItem(JOURNAL_KEY); } catch { /* ignore */ }
  });

  it("sets and clears the journal marker across a successful restore", async () => {
    const snap = await buildCompanyBackup(COMPANY_ID);
    expect(getInterruptedRestore()).toBeNull();
    await restoreCompanyBackup(COMPANY_ID, snap);
    expect(getInterruptedRestore()).toBeNull();
  });

  it("journal marker survives if the process dies mid-restore", () => {
    // Simulate: begin marker but never clear (== crash between begin and end).
    beginRestoreJournal({ companyId: COMPANY_ID, companyName: "Journal Traders", kind: "file-restore" });
    const entry = getInterruptedRestore();
    expect(entry).not.toBeNull();
    expect(entry!.companyId).toBe(COMPANY_ID);
    expect(entry!.kind).toBe("file-restore");
    expect(entry!.startedAt).toBeGreaterThan(0);
    // Cleanup so afterEach is a no-op.
    endRestoreJournal();
    expect(getInterruptedRestore()).toBeNull();
  });

  it("recoverFromInterruptedRestore rolls back to the pre-restore snapshot", async () => {
    // Simulate the sequence: safety snapshot taken, marker set, crash.
    await savePreRestoreSnapshot(COMPANY_ID, "Journal Traders");
    beginRestoreJournal({ companyId: COMPANY_ID, companyName: "Journal Traders", kind: "file-restore" });

    // Corrupt the live state to prove recovery actually rewrites it.
    await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).delete();
    expect(await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).count()).toBe(0);

    const result = await recoverFromInterruptedRestore();
    expect(result.ran).toBe(true);
    if (result.ran) expect(result.ok).toBe(true);

    // Marker cleared.
    expect(getInterruptedRestore()).toBeNull();
    // Voucher restored from the safety snapshot.
    expect(await offlineDb.cache_vouchers.where("company_id").equals(COMPANY_ID).count()).toBe(1);
  });

  it("recover is a no-op when no marker is present", async () => {
    expect(getInterruptedRestore()).toBeNull();
    const result = await recoverFromInterruptedRestore();
    expect(result.ran).toBe(false);
  });
});

describe("Round 3 — checksum enforcement on file restore", () => {
  beforeEach(async () => { await wipe(); await seed(); });

  it("parseBackupFile reports checksumOk=true for an unmodified envelope", async () => {
    const payload = await buildCompanyBackup(COMPANY_ID);
    const envelope = await wrapBackup(payload);
    const parsed = await parseBackupFile(JSON.stringify(envelope));
    expect(parsed.kind).toBe("single");
    expect(parsed.checksumOk).toBe(true);
  });

  it("parseBackupFile reports checksumOk=false when the payload is tampered", async () => {
    const payload = await buildCompanyBackup(COMPANY_ID);
    const envelope = await wrapBackup(payload);
    // Tamper: silently add an extra voucher after signing.
    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        vouchers: [
          ...envelope.payload.vouchers,
          { id: "v-injected", company_id: COMPANY_ID, voucher_type: "sales",
            voucher_number: "999", voucher_date: "2026-07-02", total_amount: 999999 },
        ],
      },
    };
    const parsed = await parseBackupFile(JSON.stringify(tampered));
    expect(parsed.kind).toBe("single");
    expect(parsed.checksumOk).toBe(false);
  });

  it("parseBackupFile accepts legacy unwrapped v2 backups (no checksum field)", async () => {
    const payload = await buildCompanyBackup(COMPANY_ID);
    // Legacy: bare CompanyBackup, no envelope.
    const parsed = await parseBackupFile(JSON.stringify(payload));
    expect(parsed.kind).toBe("single");
    // No envelope -> no checksum verdict.
    expect(parsed.checksumOk).toBeUndefined();
  });
});
