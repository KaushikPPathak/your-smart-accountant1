import { describe, it, expect } from 'vitest';
import { offlineDb } from '@/lib/offline/db';
import { recoverMissingFromSnapshot } from '@/lib/backup';
import type { CompanyBackup } from '@/lib/backup';

describe('Regression Pass 4: Concurrent Save / Auto-Restore', () => {
  const companyId = 'test-company-id';

  it('Newest committed state must not be overwritten by older snapshot', async () => {
    // 1. Initial state
    const voucherV1 = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 40000, voucher_type: 'journal', is_synced: true };
    await offlineDb.cache_vouchers.put(voucherV1);

    // 2. Snapshot taken at V1
    const snapshot: CompanyBackup = {
      schema_version: 2, exported_at: '', company: { id: companyId }, settings: null, ledgers: [], items: [],
      vouchers: [voucherV1], voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: []
    };

    // 3. User saves V2 (₹50,000)
    const voucherV2 = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 50000, voucher_type: 'journal', is_synced: true };
    
    // Simulate concurrent process: 
    // In actual code, recoverMissingFromSnapshot uses a transaction and checks `!exists`.
    // If we call recoverMissingFromSnapshot while V2 is already in DB, it should not overwrite.

    await offlineDb.cache_vouchers.put(voucherV2);
    
    // Auto-restore attempt with V1 snapshot
    await recoverMissingFromSnapshot(companyId, snapshot);

    // Verify DB still has V2
    const final = await offlineDb.cache_vouchers.get('v-1');
    expect(final.total_paise).toBe(50000);
  });
});
