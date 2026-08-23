# Implementation Plan: Data Integrity Hardening (Auto-Restore & Fingerprinting)

This plan addresses the identified "Risk-B" gaps where stale mutable state could be restored for missing records. The goal is to move from "Accounting Integrity" to "Complete User-Data Restoration Integrity."

## 1. Recommended Design: Canonical Record Fingerprinting (Option B)

Instead of manually listing fields, we will create a deterministic representation of all restorable fields.

### Why it is safer
*   **Automatic Protection**: Any new field added to the schema in the future is automatically included in the fingerprint.
*   **Deterministic**: Handles nulls, undefineds, and key ordering consistently.
*   **Zero Collisions**: Guaranteed identity for identical content.

### Proposed Field Selection
We will exclude "Volatile Metadata":
*   `updated_at`, `created_at` (timestamps)
*   `is_synced` (network state)
*   `last_error`, `attempts` (outbox state)
All other user-visible fields (Accounting, Settings, Metadata) are included.

## 2. Technical Details

### Exact Changes
*   **`src/lib/auto-restore.ts`**:
    *   Replace `voucherFingerprint`, `ledgerFingerprint`, `itemFingerprint` with a single `canonicalFingerprint(row: Record<string, unknown>, table: string)` helper.
    *   This helper will sort keys alphabetically, JSON-stringify values (converting `undefined` to `null`), and exclude the volatile blacklist.
*   **`src/lib/backup.ts`**:
    *   `recoverMissingFromSnapshot`: No logic change required, but its safety now relies on the hardened `isBackupSafeSuperset`.

### Snapshot Compatibility Strategy
*   **Detection**: Snapshots will be versioned. If a snapshot lacks the `fingerprint_version: 2` flag, it is treated as "Legacy".
*   **Migration**: When checking a Legacy snapshot, the app will generate a "Legacy Fingerprint" from the snapshot data (using the old field list) and compare it against a "Legacy Fingerprint" generated from the live data.
*   **Safety**: If a Legacy snapshot passes the legacy check, it is accepted. However, newly created snapshots will always use the Canonical method.

## 3. Data Flow

1.  **Launch**: App detects missing data via `integrity.json`.
2.  **Selection**: App finds newest snapshot.
3.  **Validation (`isBackupSafeSuperset`)**:
    *   Generate canonical fingerprints for all LIVE records.
    *   Generate canonical fingerprints for all SNAPSHOT records.
    *   Verify that for every Live record, an IDENTICAL record (all fields matching) exists in the snapshot.
4.  **Restore**: Only if Step 3 passes, `recoverMissingFromSnapshot` inserts records that are in the snapshot but not in the live DB.

## 4. Test Plan (Failure Scenarios)

1.  **Stale Balance**: Live Ledger (₹5L) / Snapshot (₹3L). Live fingerprint generated. Snapshot will not contain a record with the ₹5L fingerprint. **Result: Snapshot rejected.**
2.  **GST Drift**: Live Item (18%) / Snapshot (5%). **Result: Snapshot rejected.**
3.  **Voucher Breakdown**: Total ₹1000 identical, but CGST/SGST distribution differs. **Result: Snapshot rejected.**
4.  **Missing Fields**: Old snapshot missing `due_date`. Legacy compatibility mode handles the comparison using the old field set.

## 5. Risks & Rollback

*   **Risk**: If a user manually edits a record and then their IndexedDB crashes partially, the snapshot will be rejected (as it's no longer a superset). The user would then need to manually restore or ignore. This is the **desired behavior** to prevent silent stale data injection.
*   **Performance**: Fingerprinting large datasets (10k+ vouchers) on startup. We will use a `Web Worker` for the multiset inclusion check to prevent UI jank.
*   **Rollback**: The `integrity.json` manifest acts as a checkpoint. Reverting code will simply fall back to the old, less-strict comparison logic.

**IMPLEMENTATION PLAN ONLY — AWAITING APPROVAL**
