# Roadmap

## In progress
- [x] GSTR-9: dated outward/nature/HSN voucher drill-downs with search, filters and item detail; existing voucher editor and return-entry forms linked. Verified sample invoice edit/save/back changes taxable ₹100 → ₹200 and tax ₹18 → ₹36; Table 9 import saved/read back ₹25. 46 focused tests and official Excel export tests passed. Packaged Windows execution remains untested; Tables 10–16 remain outside the existing input model.
- [x] Make print preview/paper white with readable dark text, independent of the app theme. Isolated browser preview and host print both checked; packaged desktop remains untested.
- [x] Replace split WhatsApp ledger tables with chronological entries, continuous balances and intact page rows; 20 tests passed and all four generated sample PDF pages visually inspected without clipping, overlaps or broken rows. Desktop WhatsApp attachment remains untested.
- [x] Darken company picker, company workspace and invoice backgrounds; darker company cards and white customer/item lettering. Verified picker → company → sales invoice → customer/item selection in the running app with local sample records.
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




## Status 2026-11-03 — local-only and competitive gaps
Done:
- [x] Opening Stock and Opening Balance imports read and save through the local books (11e38c4)
- [x] Stock valuation: Average (default), FIFO or LIFO per company; Stock Summary, Trading, P&L and Balance Sheet follow the chosen method (6e1994c)
- [x] Negative stock keeps its negative value; Stock Summary has an HSN-wise compact view, 4 digits up to ₹5 crore turnover and 6 digits above it (e7e524f)
- [x] HSN / SAC code is mandatory for every item, checked against the turnover rule (d64ae55)
- [x] Manual valuation button is visible; green when a manual value is saved; items-needing-HSN notice is clickable (49cb868)
- [x] Credit and debit note original-invoice list reads from the local books (7ce9791)

Open, local-only build (the app must never fail or show empty because the cloud is missing):
- [x] HSN Summary, ITC Item-wise, ITC Party-wise and Receipts & Payments reports read this PC's books
- [x] Period lock, unlock and FY lock are kept in this PC's books (locks stay on this PC; cloud sync of locks is not included)
- [x] Voucher assistant ledger lookup reads this PC's ledgers (the AI reply itself still uses the cloud, by design)

Open, competitive features:
- [ ] TDS deduction on payment vouchers (194C, 194J, 194Q) and TCS: not present in voucher code (TDS appears only in the tax-audit report)
- [ ] Keyboard speed on voucher entry: searchable pickers (Combo) are used in Sales/Purchase, Entry, Manufacturing and Physical Stock; a full keyboard-only entry flow is not verified
- [ ] Barcode label printing: not present
- [ ] Payroll: not started
- [ ] Approval workflow: not started. Company roles (admin, accountant, viewer) exist, but nothing is approved before posting.

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
