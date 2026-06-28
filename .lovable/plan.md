I understand your frustration. I cannot directly refund credits from inside the builder, and I should not keep doing blind repeated fixes. For refunds/credit adjustment, please contact Lovable support with this project and the failed offline-sync history: https://lovable.dev/support

Current usage I can see: 155.677 credits used in the current period, 190.40 credits remaining.

Plan before any more implementation:

1. Freeze the approach
- No more patching individual reports one by one.
- Treat offline sync as one core data-integrity system, not separate screen fixes.
- Do not mark sync as complete unless the app proves online and offline row counts/checksums match.

2. Build a verification-first sync audit
- Add a deterministic “Online vs Offline Match” audit for each company.
- Compare all accounting-critical tables: companies, members, settings, ledgers, items, vouchers, voucher_entries, voucher_items, bill_allocations, groups/mappings, stock-related rows.
- Show exact mismatch: missing online rows, missing offline rows, stale offline rows, duplicate rows, orphan voucher children, and checksum differences.

3. Make sync atomic and all-or-nothing
- Pull a complete company snapshot into temporary offline tables first.
- Validate counts and referential consistency before replacing existing offline data.
- If validation fails, keep the previous offline copy untouched and show “Sync failed — existing offline data preserved.”
- Only show “All data available in offline mode” after verification passes.

4. Fix offline read source centrally
- Reports and ledger drill-down must read from the same canonical offline posting source.
- Remove report-by-report partial fallbacks that can cause Day Book, Ledger, Cash/Bank, Trial Balance, P&L, and Balance Sheet to disagree.
- Use voucher_entries as the single posting truth; voucher_items only for inventory/item reports.

5. Handle offline-to-online safely
- Push pending offline changes first.
- Verify each pushed voucher has complete header + entries + items.
- If push fails, do not pull/overwrite offline data.
- Show clear pending/failure messages with exact voucher numbers.

6. Add real-condition verification
- Use the test login you provided only for verification.
- Test online mode, forced offline mode, reload while offline, company open, ledger drill-down, cash/bank, day book, trial balance, P&L, balance sheet.
- Capture evidence from the running app before claiming the fix works.

7. Credit-protection workflow going forward
- I will not claim “fixed” from code inspection only.
- I will verify in the preview with offline simulation before reporting completion.
- If verification fails, I will report the failing evidence instead of consuming more attempts on guesswork.

What I will implement after approval:
- A single robust offline mirror engine with checksum verification.
- A visible sync audit result screen.
- Atomic local snapshot replacement.
- Centralized offline report data access so all reports match.
- Clear success/failure wording: “All data available in offline mode” only when verified.