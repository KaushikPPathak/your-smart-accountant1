# Strategic Code Reform: Optimization & Consolidation

This plan focuses on increasing report generation speed and reducing code duplication in the core accounting engine, addressing the "overloaded" feeling of the codebase.

## 1. Accounting Data Consolidation
Create a unified "Accounting Data Manifest" fetcher in `src/lib/offline/cache-read.ts`. This will allow multiple reports (Balance Sheet, P&L, Trial Balance) to share the same underlying data retrieval logic, eliminating the duplicated offline-fallback blocks in `reports.ts`.

## 2. Streamline `src/lib/reports.ts`
- Replace duplicated data fetching in `fetchLedgerBalancesWithMeta` and `fetchLedgerModeSplits` with the new unified fetcher.
- Remove redundant type mappings and simplify the calculation loops.
- Fix floating-point precision handling in total calculations.

## 3. Report Grouping Optimization
- Refactor `src/lib/report-grouping.tsx` to reduce the number of iterations over the ledger balance list.
- Remove unused `partitionBySection` function.
- Simplify the `GroupBucket` interface to reduce memory overhead for large charts of accounts.

## 4. Code Cleanup & De-duplication
- Remove redundant "Fix: ..." comments that have served their purpose and now add noise.
- Consolidate common sign-partitioning logic used across different reports into a shared utility.

## Technical Details
- New helper: `readAccountingDataset(companyId, from, to)` will return `{ ledgers, vouchers, entries }` in one promise-all block.
- Update `groupBalances` to accept an optional pre-partitioned map to avoid O(N*M) complexity in grouping.
- Ensure all currency math uses `Math.round()` to prevent the 1-paise drift reported by users.
