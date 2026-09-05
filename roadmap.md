# Roadmap

## In progress
- [ ] Print View collapses accounting tables vertically (root cause: preview iframe has no app CSS + virtualized grid clone)
- [ ] Journal Book missing from main sidebar; needs Dr/Cr accounting columns
- [ ] GST number verification fails in local-only mode ("Proxy error: Cloud functions not available")
- [ ] Telangana (inter-state) party taxed as local Gujarat sale — interstate detection broken



## Completed
- Phase 2 — Physical Stock (stock-take) voucher: executor, form, route, list UI, tests, build OK.
  - [x] Enum migration, valuation-engine branch, stock-summary window filters, schema type group, label
  - [x] Fix duplicate `isMfg` build error in stock-summary.tsx
  - [x] Executor `runPhysicalStockCreate` (local + cloud)
  - [x] `PhysicalStockForm.tsx` + route
  - [x] Vouchers list quick action + TYPES
  - [x] Regression test (5/5 pass)
  - [x] Build OK
