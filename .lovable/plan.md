# Final Implementation Plan: Data Integrity Hardening (Auto-Restore & Fingerprinting)

This plan addresses the identified "Risk-B" gaps to ensure that background auto-restoration never silently restores stale user state for missing records.

## 1. Authoritative Field Classification

We define four categories to determine participation in the Business-State Fingerprint.

| Category | Description | Entities |
|---|---|---|
| **A: Accounting Core** | Fields that define financial value. | `total_paise`, `amount_paise`, `qty`, `rate_paise`, `opening_balance_paise`. |
| **B: Business State** | User-visible configuration and descriptive state. | `name`, `gstin`, `reference_no`, `due_date`, `linked_voucher_ids`, `is_active`. |
| **C: Derived State** | Computed fields that must remain consistent with Core. | `cgst_paise`, `sgst_paise`, `taxable_paise`. |
| **D: Volatile/Internal**| Technical fields irrelevant to user-visible state. | `updated_at`, `created_at`, `is_synced`, `last_error`. |

### 2. Record Identity vs. Business-State Fingerprint

*   **Record Identity**: The set of fields required to uniquely identify the record across companies and time. This includes `id` and `company_id`.
*   **Business-State Fingerprint**: The canonical deterministic representation of all fields in Categories **A, B, and C**.
*   **Identity Mapping**: The multiset comparison will use a compound key: `[company_id + id + Business-State Fingerprint]`. This ensures that "Same ID + Different Content" or "Same ID + Different Company" results in a mismatch.
*   **Entry/Item IDs**: Entry `id` is included in the Business-State Fingerprint because while entries are children of vouchers, their specific internal ID is part of the persisted state that should not change silently.

## 3. Canonicalization & Future-Schema Policy

*   **Canonicalization Rules**:
    1.  **Selection**: Filter record to include all fields EXCEPT a hard-coded blacklist of Category D (Volatile) fields.
    2.  **Future-Schema Policy (Fail Closed)**: By using a **Blacklist** of Volatile fields rather than a Whitelist of Protected fields, any newly added persisted field is **automatically protected** by the fingerprint unless an intentional code change explicitly classifies it as Volatile.
    3.  **Normalization**: Trim strings, lowercase ID-like strings, `null` for `undefined`.
    4.  **Deterministic Ordering**: Keys sorted alphabetically before `JSON.stringify`.

## 4. Legacy Snapshot Policy

A legacy snapshot may be used for **SILENT AUTO-RESTORE** only if the application can prove the complete required restoration state.

*   **Rule**: Legacy snapshots (lacking `fingerprint_version: 2`) are checked against the **Legacy Fingerprint** (the old restricted field list).
*   **Strict Constraint**: If a legacy snapshot passes the legacy check, it is **NOT** automatically accepted for silent restore. It is only accepted if the application verifies that the legacy snapshot contains **all** current Category A/B/C fields. 
*   **Failure Mode**: If a legacy snapshot is missing a newly-protected field (e.g., `due_date` was not captured in an older backup version), the snapshot is **Disqualified** from silent auto-restore.
*   **Manual Recovery**: These backups remain fully usable for user-initiated manual recovery via the "Restore from File" interface.

## 5. Restore Decision Matrix

| Live DB | Snapshot | Content | Action |
|---|---|---|---|
| Exists | Exists | Identical | **Safe** |
| Exists | Exists | Different | **REJECTED** (Superset proof fails) |
| Exists | Missing | N/A | **Safe** (Live data is newer) |
| Missing | Exists | Proven Safe | **RESTORE** (Insert missing record) |
| Missing | Exists | Unverified | **REJECTED** (Ambiguous state) |
| Tombstoned| Exists | Any | **SKIPPED** (Tombstone wins) |

## 6. Performance & Scale

We will establish a synchronous baseline for the canonicalization of 25,000 records.
*   **Threshold**: If startup blocking exceeds **100ms** on standard hardware, we will move the comparison logic to a background worker.
*   **Serialization**: If a worker is used, we will use `Transferable` objects or partitioned processing to minimize the main-thread overhead of sending the Live/Snapshot data.

## 7. Implementation Scope

*   **`src/lib/auto-restore.ts`**:
    *   Implement `canonicalFingerprint` with Volatile Blacklist.
    *   Update `isBackupSafeSuperset` to use the compound Identity + Fingerprint multiset.
    *   Implement strict Legacy rejection for unverified state.
*   **`src/lib/integrity.ts`**:
    *   Update manifest to track `fingerprint_version`.
*   **`src/lib/backup.ts`**:
    *   **NO CHANGES**. The audit confirms that `recoverMissingFromSnapshot` is safely gated by the `isBackupSafeSuperset` check in `auto-restore.ts`. We will keep changes local to the restoration engine.

## 8. Regression Test Matrix

1.  **Opening Balance Drift**: Ledger ₹5L Live / ₹3L Snapshot. **Result: Reject.**
2.  **GST Rate Drift**: Item 18% Live / 5% Snapshot. **Result: Reject.**
3.  **Voucher Tax Breakdown**: Total identical, CGST/SGST swapped. **Result: Reject.**
4.  **Metadata Drift**: `due_date` or `reference_no` differs. **Result: Reject.**
5.  **Legacy Incomplete**: Old snapshot missing a newly protected field. **Result: Reject.**
6.  **Legacy Stale**: Old snapshot has old value for newly protected field. **Result: Reject.**
7.  **Volatile Noise**: `is_synced` or `updated_at` changes. **Result: Accept.**
8.  **Tombstone Protection**: Record deleted in Live, present in Snapshot. **Result: Skip resurrection.**
9.  **Company Isolation**: Identical ID in Snapshot but for a different company. **Result: Reject.**

## 9. Rollback & Fail-Safe

*   **Integrity Manifest**: Version mismatch in `integrity.json` will trigger a safe abort of the auto-restore task.
*   **Fail-Closed**: A rejected or ambiguous snapshot will never fall back to weaker validation. The system will log the failure and wait for user intervention.

FINAL IMPLEMENTATION PLAN — AWAITING APPROVAL