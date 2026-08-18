# Plan: Ledger Consistency Check

Implement a weekly background "Consistency Check" to ensure ledger balances match the sum of voucher entries, adding transparency and preventing accounting loopholes.

## User Review Required

> [!NOTE]
> The consistency check runs automatically in the background once a week. If a discrepancy is found, an "Audit" badge will appear in the top menu bar to alert you.

## Proposed Changes

### Logic & Storage
- Create `src/lib/offline/consistency.ts` to house the ledger-to-entry verification logic.
- Run this check in `requestIdleCallback` to ensure it doesn't affect UI performance.
- Store results in the `meta` table and dispatch a global event when drift is detected.

### Integrity Scanner Integration
- Update `src/lib/offline/integrity-scan.ts` to include the consistency check as a standard phase of the "Data Health" scan.
- Add a new `ledgerBalanceDrift` count to the integrity scan report.

### UI Improvements
- Add a high-visibility "Audit" badge to the `TopMenuBar` when consistency issues are detected.
- Wire up the weekly check to trigger on app launch (if 7 days have passed).

## Technical Details

### Verification Algorithm
- Fetch all active ledgers and all voucher entries for the current company.
- Sum all debits and credits for each ledger.
- Compare the sum (plus opening balance) against the cached balance stored on the ledger record.
- Any mismatch is flagged as a `ConsistencyIssue`.

### Background Scheduling
- The check is gated by a `last_consistency_check` timestamp in `meta` storage.
- If more than 7 days have elapsed, the check is queued using `requestIdleCallback` (with a `setTimeout` fallback for legacy environments like Win7).
