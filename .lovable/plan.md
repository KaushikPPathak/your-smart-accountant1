# Plan: Provisional Balance Sync & Year-End Lock

Extend the Financial Year Transfer module with (a) one-click opening-balance sync from prior FY, (b) an auditor-grade FY freeze toggle reusing the existing `period_locks` infrastructure, and (c) "Provisional / Audited & Locked" status badges on company cards.

## 1. Database (single migration)

Reuse existing `period_locks` table — no schema change needed. Add one RPC:

- `sync_opening_balances_from_previous_fy(_company_id uuid, _fy_start date)` — SECURITY DEFINER, admin/accountant only.
  - Computes per-ledger closing balance as of `_fy_start - 1` (= 31-Mar prev) from `opening_balance + Σ(debit-credit)` over all voucher_entries dated `< _fy_start`.
  - Compares to current `ledgers.opening_balance_paise` (interpreted with `opening_balance_is_debit`).
  - For mismatches, UPDATE `ledgers.opening_balance_paise` + `opening_balance_is_debit` to the computed closing.
  - Returns JSONB: `{ updated: n, unchanged: m, details: [{ledger_id, name, old_paise, old_is_debit, new_paise, new_is_debit}] }`.
  - Same logic for `items.opening_stock_qty` / `opening_stock_rate_paise` using `voucher_items` net inflow/outflow (manufacturing in/out + sales/purchase) — only when `companies.inventory_enabled`.

FY lock reuses `lock_period` RPC with `_return_type = 'fy_close'`, `_period = 'FY YYYY-YY'`, `_period_start = fy_start`, `_period_end = fy_end`. The existing `enforce_period_lock_vouchers` / `enforce_period_lock_child` triggers will already block all voucher CRUD in that range — no new enforcement code needed.

## 2. UI changes

**a. `src/components/housekeeping/FinancialYearTransferWizard.tsx`** — append a new section "Provisional Balance Sync" with:
- "Sync Opening Balances from Previous Year" button → calls the RPC, shows a result dialog listing every updated ledger/item (old → new), with toast summary.
- Uses current company's `financial_year_start` as `_fy_start`.

**b. New `src/components/housekeeping/YearEndLockToggle.tsx`** — switch labelled "Freeze / Lock Financial Year Data" with FY picker (defaults to active FY).
- ON: confirmation modal → calls `lock_period` RPC.
- OFF: requires ≥10-char reason → calls `unlock_period`.
- Embedded in `app.settings.tsx` (admin only) and surfaced as a card in `app.housekeeping.tsx` alongside the transfer wizard.

**c. `src/routes/app.companies.tsx` company cards** — add badge next to FY text:
- Query `period_locks` for `return_type = 'fy_close'` and `is_active = true` matching the card's FY range.
- Yellow dot + "Provisional" if no active lock; green check + "Audited & Locked" if locked.
- Hover tooltip shows lock date + locked-by.

**d. `src/components/vouchers/PeriodLockBanner.tsx`** — already present; ensure it surfaces the "This financial year is locked. No modifications allowed." copy when the matched lock has `return_type = 'fy_close'` (small label tweak only).

## 3. Helper module

`src/lib/fy-lock.ts` — thin wrappers:
- `syncOpeningBalances(companyId, fyStart)` → calls RPC, returns typed result.
- `lockFinancialYear(companyId, fyStart, fyEnd, note)` / `unlockFinancialYear(...)` — wrap existing `lock_period` / `unlock_period`.
- `getFyLockStatus(companyId, fyStart)` → returns `{ locked: boolean, lockedAt, lockedBy } | null` for badge rendering.

## 4. Out of scope

- No changes to voucher save paths — DB triggers already enforce the lock.
- No automatic background sync; user-triggered only (per spec "One-Click").
- No edits to `client.ts`, `types.ts`, `routeTree.gen.ts` (auto-managed).

## Files touched

- migration: new RPC `sync_opening_balances_from_previous_fy`
- new: `src/lib/fy-lock.ts`, `src/components/housekeeping/YearEndLockToggle.tsx`
- edit: `src/components/housekeeping/FinancialYearTransferWizard.tsx`, `src/routes/app.companies.tsx`, `src/routes/app.housekeeping.tsx`, `src/routes/app.settings.tsx`, `src/components/vouchers/PeriodLockBanner.tsx`
