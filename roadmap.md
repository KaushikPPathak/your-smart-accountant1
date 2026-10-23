# Roadmap

## In progress
- [x] GSTR-9 PDF Tables 4/5 now use books-derived figures (same source as Excel exports); sub-totals sum printed rows; regression test uses the customer's exact B2C/B2B figures
- [x] Cloud backup popup: OAuth window now opens synchronously in the click gesture before async PKCE work, so browsers no longer block it
- [x] Cloud backup on desktop app: sign-in opens in an app window (desktop shell has no popups); redirect http://localhost/oauth-callback intercepted by the shell — needs a new desktop build + users re-register the redirect address
- [x] Colour theme switched to the Dorado palette from the uploaded design file (canvas #6E5F56, workspace #998A80, sandal #A3876A); verified on the app shell
- [x] Separate GSTR-9 exports from domestic B2C; reconcile saved GST totals without taxing invoice round-off. Relevant GST/GSTR-9 regression tests passed, including official workbook export checks.
- [x] Restore automatic purchase GST while preserving editable tax totals; allow explicit sales/purchase serial-number edits. 38 focused tests passed; purchase create/save/reopen and explicit number, GST and round-off edits verified through the desktop UI.
- [x] Correct linked invoice master refresh/GST state handling and mixed taxable/tax-free sales classification; 45 focused and 352 full-suite tests passed. Desktop bill save/reopen remains unverified: browser test stayed on company picker.
- [x] Compare prescribed GSTR-9 template; consolidate outward/inward HSN summaries, include totals, and validate exports.
- [x] Accounting Query Engine: tolerate minor ledger-name typos only when exactly one strong match exists (never guess between ledgers).
- [x] Trial Balance operation in the Accounting Query Engine (engine + tests only; no Mehtaji integration yet).
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
