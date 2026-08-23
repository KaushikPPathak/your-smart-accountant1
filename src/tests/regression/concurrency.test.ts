import { describe, it, expect } from 'vitest';
import { offlineDb } from '@/lib/offline/db';
import { recoverMissingFromSnapshot } from '@/lib/backup';
import type { CompanyBackup } from '@/lib/backup';

describe('Regression Pass 4: Concurrent Save / Auto-Restore', () => {
  const companyId = 'test-company-id';

  it('Race condition simulation: Newest committed state must not be overwritten by older snapshot', async () => {
    // True concurrency in a single-threaded JS environment (Vitest/Node) is 
    // simulated via interleaved async operations. 
    
    // 1. Initial state (V1)
    const voucherV1 = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 40000, voucher_type: 'journal', is_synced: true };
    await offlineDb.cache_vouchers.put(voucherV1);

    const snapshot: CompanyBackup = {
      schema_version: 2, exported_at: '', company: { id: companyId }, settings: null, ledgers: [], items: [],
      vouchers: [voucherV1], voucher_items: [], voucher_entries: [], bill_allocations: [], recurring_invoices: []
    };

    // 2. Start Restore operation (it will wait at the transaction start or after first read)
    // 3. Simultaneously start a Save operation (V2)
    const voucherV2 = { id: 'v-1', company_id: companyId, voucher_date: '2026-01-01', total_paise: 50000, voucher_type: 'journal', is_synced: true };
    
    // Overlapping execution:
    // We initiate the restore process. It checks if the record exists.
    // If the save completes BEFORE the restore's 'exists' check or INSIDE the same transaction,
    // the restore MUST see the new record and skip it.
    
    await Promise.all([
      recoverMissingFromSnapshot(companyId, snapshot),
      offlineDb.cache_vouchers.put(voucherV2)
    ]);

    // 4. Verify DB state. Final state must be V2.
    const final = await offlineDb.cache_vouchers.get('v-1');
    expect(final.total_paise).toBe(50000);
  });
});
