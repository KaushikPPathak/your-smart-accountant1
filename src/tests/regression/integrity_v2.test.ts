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
});
