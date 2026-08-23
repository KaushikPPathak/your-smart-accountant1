import { describe, it, expect, beforeEach, vi } from 'vitest';
import { offlineDb } from '@/lib/offline/db';
import { recoverMissingFromSnapshot } from '@/lib/backup';
import { isTombstoned, addTombstone } from '@/lib/recovery/tombstones';
import { runAutoRestore, isBackupSafeSuperset } from '@/lib/auto-restore';
import type { CompanyBackup } from '@/lib/backup';

describe('Regression Pass 1: Auto-Restore Tombstone & Data Integrity', () => {
  const companyId = 'test-company-id';
  const companyName = 'Test Company';

  beforeEach(async () => {
    await offlineDb.cache_vouchers.clear();
    await offlineDb.cache_companies.clear();
    await offlineDb.companies.clear();
    await offlineDb.meta.clear();
  });

  it('Test A & B: Deleted voucher & company remain deleted (Tombstone test)', async () => {
    // 1. Setup company and voucher
    const voucherA = { id: 'v-a', company_id: companyId, voucher_date: '2026-01-01', total_paise: 50000, voucher_type: 'journal', is_synced: true };
    await offlineDb.cache_companies.put({ id: companyId, name: companyName });
    await offlineDb.companies.put({ id: companyId, name: companyName });
    await offlineDb.cache_vouchers.put(voucherA);

    // 2. Create snapshot
    const snapshot: CompanyBackup = {
      schema_version: 2,
      exported_at: new Date().toISOString(),
      company: { id: companyId, name: companyName },
      settings: null,
      ledgers: [],
      items: [],
      vouchers: [voucherA],
      voucher_items: [],
      voucher_entries: [],
      bill_allocations: [],
      recurring_invoices: []
    };

    // 3. Delete company intentionally and persist tombstone
    await addTombstone(companyId, companyName);
    await offlineDb.cache_companies.delete(companyId);
    await offlineDb.companies.delete(companyId);
    await offlineDb.cache_vouchers.delete('v-a');

    // 4. Trigger auto-restore check
    // In actual app, runAutoRestore lists companies from `offlineDb.companies` or `offlineDb.cache_companies`.
    // Since we deleted them and added a tombstone, runAutoRestore should skip it.
    const outcome = await runAutoRestore([{ id: companyId, name: companyName }]);
    
    // Result: Tombstone prevents resurrection
    expect(outcome).toHaveLength(0);
    const exists = await offlineDb.cache_vouchers.get('v-a');
    expect(exists).toBeUndefined();
  });

  it('Test D & E: Edited record & Same ID different content rejection', async () => {
    const originalVoucher = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 40000, voucher_type: 'journal' };
    const editedVoucher = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 50000, voucher_type: 'journal' };

    const liveBackup: CompanyBackup = {
      schema_version: 2, exported_at: '', company: null, settings: null, ledgers: [], items: [],
      vouchers: [editedVoucher], voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: []
    };

    const snapshot: CompanyBackup = {
      schema_version: 2, exported_at: '', company: null, settings: null, ledgers: [], items: [],
      vouchers: [originalVoucher], voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: []
    };

    // isBackupSafeSuperset must return false because the live voucher (50k) is NOT in the snapshot (40k).
    // The fingerprint includes total_paise.
    const isSafe = isBackupSafeSuperset(snapshot, liveBackup);
    expect(isSafe).toBe(false);
  });
});
