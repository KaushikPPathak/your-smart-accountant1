# Implementation Checkpoint: Data Integrity Hardening

## 1. Exact Files to be Modified
- `src/lib/auto-restore.ts`
- `src/lib/integrity.ts`

## 2. Exact Functions to be Changed
- `src/lib/auto-restore.ts`:
  - `voucherFingerprint`, `ledgerFingerprint`, `itemFingerprint`, `entryFingerprint`, `voucherItemFingerprint`: These will be replaced by a unified `canonicalFingerprint` helper.
  - `isBackupSafeSuperset`: Refactored to use the hardened canonical multiset comparison and identity matching.
  - `runAutoRestore`: Updated to handle fingerprint versioning and legacy snapshot safety (fail-closed).
- `src/lib/integrity.ts`:
  - `IntegrityEntry` interface: Added `fingerprintVersion`.
  - `recordIntegrityFromSnapshot`: Updated to stamp the current fingerprint version.
  - `getAllIntegrity`, `getIntegrity`: Updated to handle versioned rehydration.

## 3. Existing Protected APIs (Untouched)
- `src/lib/backup.ts`: `recoverMissingFromSnapshot` and `restoreCompanyBackup` remain untouched; their safety is guaranteed by the hardened validation layer.
- `src/lib/offline/db.ts`: The Dexie schema and transaction logic remain unchanged.
- `src/lib/local-only-mode.ts`: Local-only constraints remain active.

## 4. Confirmations
- **Backups**: Verified. No application code will delete, rotate, or overwrite backup files.
- **Authority**: Verified. Dexie/IndexedDB remains the sole authoritative store for accounting data.
- **Integer Paise**: Verified. All monetary values remain integer paise; no floating-point conversions.
- **Server Sync**: Verified. No new network synchronization or cloud egress is introduced.
- **Rollback**: Verified. Fail-closed logic ensures that disabling the new version prevents silent fallback to weak validation.
- **Identifiers**: Verified. Database IDs (`id`, `company_id`, etc.) will be preserved exactly without lowercasing or trimming during canonicalization.

Proceeding with implementation of the approved Data Integrity Hardening plan.