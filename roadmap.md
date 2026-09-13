# Roadmap

## In progress
- [x] Fix Cash/Bank and Journal grids hanging after rows load (worker accessor serialization failure); add worker-error fallback.
- [ ] Print View collapses accounting tables vertically (root cause: preview iframe has no app CSS + virtualized grid clone)
- [ ] Journal Book missing from main sidebar; needs Dr/Cr accounting columns
- [x] GST number verification works without the cloud client (direct HTTPS call to the verification endpoint)
- [x] Telangana (inter-state) party now taxed as IGST — state resolved from GSTIN / code / written state name, company state read locally




## Completed
- Cash Book, Bank Book and Journal Book use one bounded local-data read; shared grid processing now restores stripped accessors and falls back safely if its worker fails.
- Balance Sheet sign-switched ledgers are retained in valid opposite-side groups; regression covers the exact ₹1,04,672.09 omitted debit balances.
- Phase 2 — Physical Stock (stock-take) voucher: executor, form, route, list UI, tests, build OK.
  - [x] Enum migration, valuation-engine branch, stock-summary window filters, schema type group, label
  - [x] Fix duplicate `isMfg` build error in stock-summary.tsx
  - [x] Executor `runPhysicalStockCreate` (local + cloud)
  - [x] `PhysicalStockForm.tsx` + route
  - [x] Vouchers list quick action + TYPES
  - [x] Regression test (5/5 pass)
  - [x] Build OK
