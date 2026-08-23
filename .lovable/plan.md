# Revised Implementation Plan: Data Integrity Hardening (Auto-Restore & Fingerprinting)

This plan addresses the identified "Risk-B" gaps where stale mutable state could be restored for missing records. The objective is to move from "Accounting Integrity" to "Complete User-Data Restoration Integrity."

## 1. Authoritative Field Classification

We define four categories of fields to determine participation in fingerprinting.

| Table | A: Authoritative Business/Accounting | B: User-Visible Config/State | C: Derived/Cache | D: Volatile/Runtime/Internal |
|---|---|---|---|---|
| **Company** | `name`, `gstin`, `financial_year_start`, `currency_code`, `inventory_enabled` | `address`, `phone`, `email`, `logo_url`, `mode` | - | `updated_at`, `created_at`, `access_password_hash` |
| **Ledger** | `name`, `group_code`, `opening_balance_paise`, `opening_balance_is_debit` | `gstin`, `gst_treatment`, `is_active`, `address`, `phone` | - | `updated_at`, `created_at`, `is_synced` |
| **Item** | `name`, `unit`, `hsn_code`, `gst_rate`, `opening_stock_qty` | `sale_price_paise`, `purchase_price_paise`, `is_active` | - | `updated_at`, `created_at`, `is_synced` |
| **Voucher** | `date`, `voucher_type`, `voucher_number`, `total_paise`, `party_ledger_id` | `reference_no`, `due_date`, `narration`, `linked_voucher_ids`, `status` | `subtotal_paise`, `round_off_paise`, `cgst_paise`, `sgst_paise`, `igst_paise` | `updated_at`, `created_at`, `is_synced`, `created_by` |
| **Entry** | `ledger_id`, `entry_type`, `amount_paise` | - | - | `id`, `voucher_id`, `created_at` |
| **V. Item** | `item_id`, `qty`, `rate_paise`, `amount_paise` | `description`, `specs` | `cgst_paise`, `sgst_paise`, `igst_paise`, `taxable_paise` | `id`, `voucher_id`, `created_at` |

**Fingerprinting Rule**: Only fields in Categories **A**, **B**, and **C** participate in the fingerprint. Category **D** (Volatile) and **E** (Internal/Migration) are strictly excluded to prevent false snapshot rejections.

## 2. Canonicalization & Fingerprinting Design

*   **Deterministic Equality**: Canonicalization provides deterministic equality. We will use direct canonical representation comparison for the multiset check. If hashing is required for memory efficiency, SHA-256 will be used.
*   **Canonicalization Rules**:
    1.  **Selection**: Filter record to include only Categories A, B, C.
    2.  **Normalization**: Trim strings, lowercase names/groups, `null` for `undefined`.
    3.  **Ordering**: Deterministic alphabetical sorting of keys.
    4.  **Representation**: `JSON.stringify` of the sorted object.
*   **Company Isolation**: The `company_id` is always prepended to the canonical string to ensure cross-company same-ID records generate different fingerprints.

## 3. Legacy Snapshot Safety Policy

A legacy fingerprint cannot prove the safety of fields that were not included in the old fingerprint.

*   **Policy**: Legacy snapshots (created before this implementation) are identified by the absence of a `fingerprint_version: 2` header.
*   **Verification**: For every record in a legacy snapshot, the app will generate the **New Fingerprint** by assuming the missing/unverified fields match the Live state.
*   **Rejection**: If a legacy snapshot contains a value for a newly-protected field (e.g., `opening_balance_paise`) and that value differs from the Live state, the snapshot is **Rejected**.
*   **Safety**: If the field is missing from the snapshot entirely, the snapshot is rejected for that entity type. We do not infer equality for unverified fields.
*   **Usability**: Existing backups remain usable for **manual** restores (where the user takes responsibility) but are disqualified from **silent** auto-restore if they cannot provide a complete integrity proof.

## 4. Restore Decision Matrix

| Live State | Snapshot State | Identity | Content | Action |
|---|---|---|---|---|
| Active | Missing | Match | N/A | **Accepted** (Snapshot is a superset) |
| Active | Present | Match | Identical | **Accepted** |
| Active | Present | Match | Different | **REJECTED** (Superset proof fails) |
| Tombstoned | Present | Match | Any | **SKIPPED** (Tombstone takes precedence) |
| Missing | Present | Match | N/A | **Accepted** (Restore missing record) |

## 5. Rollback & Fail-Safe Behavior

*   **Destruction Prevention**: Backups are never deleted. Live data is never overwritten by `recoverMissingFromSnapshot`.
*   **Hard Fail-Safe**: If the new implementation is disabled or rolls back, the `integrity.json` manifest version mismatch will cause the auto-restore task to abort with an "Unsupported Integrity Version" error.
*   **No Silent Fallback**: We will not fall back to the old weaker validation. A failed integrity check requires user intervention via the "Data Sync" or "Restore from File" UI.

## 6. Regression Test Matrix

1.  **Balance Drift**: Live Ledger ₹5L / Snapshot ₹3L. **Result: Reject.**
2.  **GST Drift**: Item GST 18% / Snapshot 5%. **Result: Reject.**
3.  **Breakdown Drift**: Voucher total ₹1000 identical, but CGST/SGST differs. **Result: Reject.**
4.  **Reference Drift**: `reference_no` or `due_date` differs. **Result: Reject.**
5.  **Legacy Incomplete**: Old snapshot missing `linked_voucher_ids`. **Result: Reject.**
6.  **Legacy Stale**: Old snapshot has old `opening_balance`. **Result: Reject.**
7.  **Noise Immunity**: `updated_at` or `is_synced` changes. **Result: Accept.**
8.  **Tombstone**: Deleted record in live DB vs active in snapshot. **Result: Skip resurrection.**
9.  **Scale**: 10,000+ record multiset comparison performance profiling.

## 7. Implementation Details

*   **Files to Change**:
    *   `src/lib/auto-restore.ts`: Implement `canonicalFingerprint`, `isBackupSafeSuperset` v2 logic, and legacy compatibility layer.
    *   `src/lib/integrity.ts`: Update `recordIntegrityFromSnapshot` to include fingerprint versioning.
    *   `src/lib/backup.ts`: Update `recoverMissingFromSnapshot` to enforce company isolation and tombstone checks.
*   **Performance Strategy**: Fingerprinting will be performed synchronously first. If profiling shows blocking > 100ms, the multiset check will be moved to a `postMessage` worker pattern.

REVISED IMPLEMENTATION PLAN — AWAITING APPROVAL
