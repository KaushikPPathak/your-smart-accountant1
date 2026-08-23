import { describe, it, expect, beforeEach } from 'vitest';
import { offlineDb } from '@/lib/offline/db';
import { isBackupSafeSuperset, canonicalFingerprint } from '@/lib/auto-restore';
import type { CompanyBackup } from '@/lib/backup';
import type { IntegrityEntry } from '@/lib/integrity';


describe('Hardened Data Integrity Regression Matrix', () => {
  const companyId = 'comp-A';
  
  beforeEach(async () => {
    await offlineDb.cache_ledgers.clear();
    await offlineDb.cache_items.clear();
    await offlineDb.cache_vouchers.clear();
  });

  it('1. Ledger Opening Balance Drift (Reject)', () => {
    const live = { id: 'l1', company_id: companyId, name: 'Cash', group_code: 'cash', opening_balance_paise: 500000 };
    const snap = { id: 'l1', company_id: companyId, name: 'Cash', group_code: 'cash', opening_balance_paise: 300000 };
    
    const liveBackup: CompanyBackup = { vouchers: [], ledgers: [live], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [], ledgers: [snap], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('2. Item GST Rate Drift (Reject)', () => {
    const live = { id: 'i1', company_id: companyId, name: 'Widget', gst_rate: 18 };
    const snap = { id: 'i1', company_id: companyId, name: 'Widget', gst_rate: 5 };
    
    const liveBackup: CompanyBackup = { vouchers: [], ledgers: [], items: [live], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [], ledgers: [], items: [snap], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('3. Voucher Tax Breakdown Drift (Reject)', () => {
    const live = { id: 'v1', company_id: companyId, total_paise: 1000, cgst_paise: 90, sgst_paise: 90 };
    const snap = { id: 'v1', company_id: companyId, total_paise: 1000, cgst_paise: 80, sgst_paise: 100 };
    
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('4. Metadata Drift - Due Date (Reject)', () => {
    const live = { id: 'v1', company_id: companyId, due_date: '2026-12-31' };
    const snap = { id: 'v1', company_id: companyId, due_date: '2026-11-30' };
    
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('5. Legacy Incomplete - Missing Field (Reject)', () => {
    const live = { id: 'v1', company_id: companyId, linked_voucher_ids: ['v2'] };
    // Legacy snapshot record missing the linked_voucher_ids field entirely
    const snap = { id: 'v1', company_id: companyId }; 
    
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 1 } as any; // Legacy

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('6. Volatile Noise - is_synced (Accept)', () => {
    const live = { id: 'v1', company_id: companyId, total_paise: 1000, is_synced: true };
    const snap = { id: 'v1', company_id: companyId, total_paise: 1000, is_synced: false };
    
    // We need one extra record in snapshot to satisfy superset requirement (> live)
    const extra = { id: 'v2', company_id: companyId, total_paise: 2000 };
    
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap, extra], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(true);
  });

  it('7. Company Isolation (Reject)', () => {
    const live = { id: 'v1', company_id: 'comp-A', total_paise: 1000 };
    const snap = { id: 'v1', company_id: 'comp-B', total_paise: 1000 };
    
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const manifest: IntegrityEntry = { fingerprintVersion: 2 } as any;

    expect(isBackupSafeSuperset(snapBackup, liveBackup, manifest)).toBe(false);
  });

  it('8. Identifier Preservation (Direct Comparison)', () => {
    const row = { id: 'CaseSensitiveID', company_id: 'CompA' };
    const finger = canonicalFingerprint(row);
    // Should NOT be lowercased
    expect(finger).toContain('CaseSensitiveID');
    expect(finger).toContain('CompA');
  });

  it('9. Nested Object Canonicalization (Deep Sorting Proof)', () => {
    // Test 1: Nested object key order does NOT change fingerprint
    const rowA = { id: 'v1', specs: { a: 1, b: 2 } };
    const rowB = { id: 'v1', specs: { b: 2, a: 1 } };
    expect(canonicalFingerprint(rowA as any)).toBe(canonicalFingerprint(rowB as any));

    // Test 2: Deeply nested object key order does NOT change fingerprint
    const rowDeepA = { id: 'v1', meta: { nested: { y: 2, x: 1 }, z: 3 } };
    const rowDeepB = { id: 'v1', meta: { z: 3, nested: { x: 1, y: 2 } } };
    expect(canonicalFingerprint(rowDeepA as any)).toBe(canonicalFingerprint(rowDeepB as any));

    // Test 3: Array order DOES change fingerprint (semantic persistence)
    const rowArrA = { id: 'v1', linked_voucher_ids: ['a', 'b'] };
    const rowArrB = { id: 'v1', linked_voucher_ids: ['b', 'a'] };
    expect(canonicalFingerprint(rowArrA as any)).not.toBe(canonicalFingerprint(rowArrB as any));

    // Test 4: Changing an array element DOES change fingerprint
    const rowArrC = { id: 'v1', linked_voucher_ids: ['a', 'c'] };
    expect(canonicalFingerprint(rowArrA as any)).not.toBe(canonicalFingerprint(rowArrC as any));
  });

  it('10. Business Logic & Stability Proof', () => {
    // Test 5: Changing a nested accounting/business value DOES change fingerprint
    const row1 = { id: 'v1', items: [{ item_id: 'i1', qty: 10 }] };
    const row2 = { id: 'v1', items: [{ item_id: 'i1', qty: 11 }] };
    expect(canonicalFingerprint(row1 as any)).not.toBe(canonicalFingerprint(row2 as any));

    // Test 6: Changing a volatile field does NOT change fingerprint
    const rowVol1 = { id: 'v1', total_paise: 1000, updated_at: '2026-01-01' };
    const rowVol2 = { id: 'v1', total_paise: 1000, updated_at: '2026-01-02' };
    expect(canonicalFingerprint(rowVol1 as any)).toBe(canonicalFingerprint(rowVol2 as any));

    // Test 7: Same ID + different nested content → REJECT (simulated via isBackupSafeSuperset)
    const live = { id: 'v1', company_id: 'c1', meta: { val: 1 } };
    const snap = { id: 'v1', company_id: 'c1', meta: { val: 2 } };
    const liveBackup: CompanyBackup = { vouchers: [live], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackup: CompanyBackup = { vouchers: [snap], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    expect(isBackupSafeSuperset(snapBackup, liveBackup, { fingerprintVersion: 2 } as any)).toBe(false);

    // Test 8: Same ID + different company → REJECT
    const liveC = { id: 'v1', company_id: 'c1' };
    const snapC = { id: 'v1', company_id: 'c2' };
    const liveBackupC: CompanyBackup = { vouchers: [liveC], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    const snapBackupC: CompanyBackup = { vouchers: [snapC], ledgers: [], items: [], voucher_entries: [], voucher_items: [] } as any;
    expect(isBackupSafeSuperset(snapBackupC, liveBackupC, { fingerprintVersion: 2 } as any)).toBe(false);
  });

  it('11. 25,000 Record Performance Benchmark (Recursive)', () => {
    const RECORD_COUNT = 25000;
    const template = {
      id: "v-uuid", company_id: "c-uuid", voucher_date: "2026-08-23",
      voucher_type: "sales", total_paise: 1250000, narration: "Testing recursive performance",
      metadata: { source: "pos", terminal: "t-01", details: { zone: "north", clerk: "user-1" } },
      items: [{ id: "i1", qty: 5 }, { id: "i2", qty: 10 }]
    };

    const records = Array.from({ length: RECORD_COUNT }, (_, i) => ({
      ...template, id: `v-${i}`, total_paise: 1000 + i
    }));

    const iterations = 3;
    const timings = [];

    for (let iter = 0; iter < iterations; iter++) {
      const start = performance.now();
      const fingerprints = records.map(r => canonicalFingerprint(r as any));
      const counts = new Map();
      for (const f of fingerprints) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const end = performance.now();
      timings.push(end - start);
    }
    
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    const avg = timings.reduce((a, b) => a + b, 0) / iterations;

    console.log(`RECURSIVE_BENCHMARK_25K: Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms, Avg: ${avg.toFixed(2)}ms`);
    expect(avg).toBeLessThan(1000); 
  });
});
