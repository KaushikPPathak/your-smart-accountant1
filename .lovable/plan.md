# Manufacturing Journal + Income Tax Audit Suite

Large, multi-module build. Splitting into 4 phased deliverables so each is verifiable.

## Phase 1 — Generalized Manufacturing Journal (rebuild)

Replace the current `ManufacturingVoucherForm` with a multi-industry layout.

**Schema (migration):**
- Reuse `voucher_items` (`specs jsonb` already exists for adaptive attributes like Grade/Brix/GSM).
- Add columns on `vouchers`: `processing_overhead_paise bigint default 0`, `scrap_value_paise bigint default 0`, `process_yield_pct numeric`.
- Add `voucher_items.role text` (`input` | `output` | `scrap`) to distinguish lines (default `output` to stay backward compatible).

**UI:**
- Three stacked grids: **Raw Materials (Inputs)**, **Processing Overhead** (labor/electricity/machine — free-form expense rows posting to nominal ledgers), **Outputs & Scrap**.
- Inputs columns: Item, Unit, Qty, Rate, Total, Attributes (JSON popover — Grade, Brix %, GSM, Moisture, free key/value).
- Outputs columns: Item, Unit, Qty, Auto Unit Cost, Total (cost loaded).
- Reconciliation widget (sticky right): Input Wt vs Output Wt, Yield %, Loss %, Cost/unit breakdown.
- Auto cost = (Σ Input + Overhead − Scrap) / Σ Output Qty (allocated by qty; weight-based allocation toggle later).
- Keyboard: Enter advances horizontally; Tab/Shift+Tab still work; Ctrl+S saves.

**Posting:** Dr Finished Goods (output value), Cr Raw Materials (input value), Dr Overhead expenses → Cr Cash/Bank/Payables (only if user picks a "fund" ledger; otherwise loaded into FG as cost memo). Inventory moves via `voucher_items` (qty + role).

## Phase 2 — Income Tax Block-of-Assets + Section 43B + 40A(3) data layer

**Migration:**
- `it_asset_blocks` (company_id, code, name, rate_pct) — seed: BUILDING_10, PM_15, COMPUTER_40, FURNITURE_10, INTANGIBLE_25, MV_15, MV_30.
- `it_fixed_assets` (company_id, block_code, ledger_id nullable, name, opening_wdv_paise, fy_start date).
- `it_asset_movements` (asset_id, fy_start, kind `addition|deletion`, date, amount_paise, ≥180 derived).
- `it_43b_clearances` (company_id, ledger_id, fy_end, cleared_on date, cleared_paise, reference).
- `it_settings` (company_id, book_depr_rate_pct jsonb-by-group, return_filing_deadline date).

RLS: standard `is_company_member` / `can_write_company` pattern.

## Phase 3 — Tax Audit Preview (Form 3CD) dashboard

Route `app/reports/tax-audit` with tabs:
1. **40A(3) Cash Scanner** — scans `voucher_entries` joined to `vouchers` where voucher_type ∈ payment, contra Cr to cash ledger, grouped by (date, party ledger), flag aggregate > ₹10,000.
2. **43B Dues Tracker** — opening + movement of GST Payable / TDS Payable / PF / ESI / Bonus ledgers (matched by `group_code` in DUTIES_TAXES + name heuristics, plus user-tagged), with editable `cleared_on` per ledger.
3. **IT Depreciation Schedule** — grid by block: Opening WDV, Additions ≥180d, Additions <180d, Deletions, Depreciation (full / half rate), Closing WDV. Add/edit assets in modal.
4. **Computation summary** — drives the Tax-View P&L.

## Phase 4 — Tax View toggle in P&L + Balance Sheet, and Audit Pack export

- Add `<ViewSwitcher>` "Standard / Tax Audit" on `app.reports.profit-loss.tsx` and `app.reports.balance-sheet.tsx`.
- Tax-View P&L side panel:
  - Net Profit (books)
  - + 40A(3) disallowance (from Phase 3 scanner)
  - + 40(a)(ia) — manual entry table (rows the user adds; later auto from TDS module)
  - + Book Depreciation (sum of expense ledgers in DEPRECIATION subgroup)
  - − IT Depreciation (from block schedule)
  - = Taxable PGBP
- Tax-View Balance Sheet: replace Fixed Assets bucket rows with IT block closing WDV rows (group label "Fixed Assets — as per IT Act").
- **Export Audit Pack** button on Tax Audit dashboard → single XLSX (via existing dynamic `loadXlsx` helper) with sheets: P&L (Books), P&L (Tax), Balance Sheet (Books), Balance Sheet (Tax), 40A(3), 43B, IT Depreciation, Computation.

## Technical notes (for the curious)

- All paise stored as bigint; rates as numeric.
- `loadXlsx()` from `src/lib/exporters.ts` already dynamic-imports SheetJS — reuse.
- New compute lives in `src/lib/tax-audit.ts` (pure functions, unit-testable).
- Block-of-asset half-rate logic: `dep = rate * (opening + additions_>=180 - deletions) + 0.5 * rate * additions_<180`.
- Keyboard handling: reuse `useEnterAsTab` from `src/components/vouchers/useEnterAsTab.tsx`.
- No new external deps required.

## Scope I am NOT doing in this pass (call out)

- Auto-detection of 40(a)(ia) TDS non-deduction (needs a TDS module — left as manual entry rows for now).
- Weight-based cost allocation across multiple outputs (qty-based v1; toggle later).
- 3CA/3CB PDF generation — only 3CD-style preview + Excel export.
- ITR JSON export.

## Suggested merge order

Phase 1 → migration for Phase 2 → Phase 3 dashboard → Phase 4 toggle + export. Each phase is independently shippable.

Confirm and I'll start with Phase 1 + the Phase 2 migration in the same turn (since migration needs your approval before code lands).
