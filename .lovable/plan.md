## Goal

Stop the whack-a-mole. Replace scattered, copy-pasted logic across reports, books, vouchers, and PDF exports with a small set of shared helpers, then apply them uniformly across **every** screen — not just the one currently complained about.

## Root causes of the recent regressions

1. **Voucher number sorted as text** in many DB queries → "10" sorts before "2", so an edited voucher with a higher number lands "out of order".
2. **Narration column** built independently in each report → some include `reference_no` fallback, some don't.
3. **Date formatting** (`DD-MM-YYYY`) applied per file → easy to miss a column, easy to regress.
4. **Back navigation** (`markVoucherOrigin` / `goBackFromVoucher`) wired in 6 screens but missing from others (Bank, Outstanding, BRS, GST books, Group Ledger, e-invoice, Recurring, Dashboard quick links).
5. **PDF report layout rules** (totals only on last page, header on every page, page X of Y, narration column hidden when empty, Indian dates) currently live only in the ledger PDF.

## Deliverables (central helpers)

| Helper | Lives in | Replaces |
|---|---|---|
| `vchSortKey(s)` + `sortVouchersByDateThenNumber(rows)` | `src/lib/voucher-sort.ts` (new) | Ad-hoc sort blocks in cash-bank, day-book, ledger, sales/purchase register, bank, outstanding, BRS, group-ledger, GST books, e-invoice, recurring, dashboard, RecentVouchersPanel |
| `narrationOf(entry, voucher)` → `entry.narration ‖ voucher.narration ‖ voucher.reference_no ‖ ""` | `src/lib/voucher-text.ts` (new) | Inline `?? ""` chains in every report |
| `fmtIndianDate` (already exists) | `src/lib/format-date.ts` | Audit every `voucher_date`, `due_date`, `cleared_date`, `vendor_invoice_date`, `invoice_date` render and export cell |
| `openVoucherDetail(navigate, voucherId)` (wraps `markVoucherOrigin` + `navigate`) | extend `src/lib/voucher-return.ts` | Replace the 7 inline `(markVoucherOrigin(), navigate(...))` call sites and add it to the missing screens |
| `downloadReportPdf({...})` — wraps `downloadPdfTable` and bakes in: header on every page, page X of Y centered footer, totals/closing only on last page, narration column auto-hidden if all values empty, Indian date subtitle | `src/lib/exporters.ts` (extend) | Per-report PDF setup in cash-bank, day-book, ledger, sales/purchase register, outstanding, GST books, BRS, trial balance, P&L, balance sheet |

## Sweep checklist (every screen touched)

**Reports / books — apply all 4 helpers:**
- `app.reports.cash-bank.tsx`
- `app.reports.day-book.tsx`
- `app.reports.ledger.tsx`
- `app.reports.sales-register.tsx` + `app.reports.purchase-register.tsx`
- `app.reports.outstanding.tsx` + `receivables.tsx` + `payables.tsx`
- `app.reports.brs.tsx`
- `app.reports.group-ledger.tsx`
- `app.reports.ageing.tsx`
- `app.reports.trial-balance.tsx`, `profit-loss.tsx`, `balance-sheet.tsx`, `trading.tsx`
- `app.reports.stock-summary.tsx`
- `app.reports.gstr1.tsx`, `gstr2b.tsx`, `gstr3b.tsx`, `gst-sales-book.tsx`, `gst-purchase-book.tsx`, `components/reports/GstBook.tsx`

**Voucher entry / list / dashboard — sort + open helper + dates:**
- `app.vouchers.tsx`, `app.vouchers.$voucherId.tsx`
- `app.vouchers.new.*` (sales, purchase, receipt, payment, journal, contra, credit_note, debit_note, delivery_note, quotation, sales_order)
- `components/vouchers/EntryVoucherForm.tsx`, `ItemVoucherForm.tsx`, `RecentVouchersPanel.tsx`, `BillAllocationDialog.tsx`
- `app.bank.tsx`, `app.einvoice.tsx`, `app.recurring.tsx`, `app.index.tsx`

**PDF printouts — adopt `downloadReportPdf` + audit `invoice-pdf.ts`:**
- All report PDFs above
- `src/lib/invoice-pdf.ts` (sales/purchase invoice printout — verify Indian dates, narration/reference, totals position)

**Navigation:**
- Add `markVoucherOrigin` to every place a voucher row is clickable (Bank, Outstanding, BRS, GST books, Group Ledger, e-invoice, Recurring, Dashboard tiles).
- Confirm `goBackFromVoucher` covers post-save and post-delete paths in `app.vouchers.$voucherId.tsx`.

## QA before I declare done

For each of the changes above I will:
1. Build (auto by harness).
2. Render the cash-bank, ledger, day-book, sales-register, and outstanding PDFs to image and visually inspect: chronological order, narration column visibility, totals only on last page, header on every page, "Page X of Y", `DD-MM-YYYY` everywhere, reference_no surfacing when narration is blank.
3. Spot-check the dashboard, vouchers list, and bank screen for sort + back-button behaviour.
4. Report the QA result in the closing message — what I checked and what I confirmed.

## What I will NOT change

- Database schema, RLS, totals math, GST logic, balances, or any business rule.
- Voucher numbering sequence behaviour.
- Existing UI styling beyond what the helpers require.

## Out of scope (postponed unless you ask)

- The earlier "Phase 1" plan you postponed.
- Any new report or feature.
- Auth, billing, deployment.

## Order of execution

1. Create `voucher-sort.ts`, `voucher-text.ts`, extend `voucher-return.ts` and `exporters.ts`.
2. Migrate cash-bank, day-book, ledger, sales/purchase register first (the screens with active complaints).
3. Migrate the remaining reports.
4. Migrate voucher-entry / list / dashboard / bank / e-invoice / recurring.
5. Audit `invoice-pdf.ts`.
6. QA pass with rendered PDFs.
