## Goal
Remove the hidden 500-row cap on the Vouchers list without any risk to existing screens. Virtualization is already in place via `DataGrid`, so we only need to feed it the full result set — safely.

## Zero-risk rules (same as Step 2)
1. No changes to voucher save/edit/delete, sync, backup, or any business logic.
2. Every new path is wrapped in try/catch and falls back to the current behaviour on any failure.
3. One file changed, verified before moving on.

## Changes (all inside `src/routes/app.vouchers.tsx`)

### 1. Cache path
Replace `.slice(0, 500)` with the full array. The cache read already filters by `voucher_type + from + to`, and `readVouchers` sorts by date desc — so removing the slice just lets more rows through. `DataGrid` virtualizes them.

### 2. Cloud path
Replace the single `.limit(500)` call with a paged fetch:
- Use Supabase `.range(offset, offset + pageSize - 1)` in a loop.
- `pageSize = 1000`, stop when a page returns fewer than `pageSize` rows or when we hit a safety ceiling (e.g. 50k rows) — configurable constant.
- Wrap the whole loop in the existing try/catch; on ANY error we already fall back to `loadFromCache()`, unchanged.

### 3. Guardrails
- If the fetch takes > N ms or exceeds the safety ceiling, log a `console.warn` and stop — user still sees a virtualized list of what was loaded.
- The date filters (`from` / `to`) already default to the current financial year via the toolbar, so in practice the paged fetch rarely exceeds one page.

## What will NOT change
- No schema, no RLS, no indexes (Step 1 already covered index needs).
- No changes to `DataGrid`, `ReportToolbar`, filters, search, or export.
- No changes to totals, formulas, or invariants.
- Stress test (`stress-10k.test.ts`) must stay green.

## Verification
1. Build passes.
2. Stress test passes.
3. Open Vouchers list on a company with > 500 vouchers in the current FY and confirm the count in the grid footer matches the DB count (`select count(*) from vouchers where company_id=... and voucher_date between ...`).
4. Scroll to the bottom — virtualization keeps it smooth.
5. Change filters (type / date / search) and confirm results update as before.

## Rollback
Single-file change. If anything looks off, restore the two capped lines (`.limit(500)` and `.slice(0, 500)`) — no other file is touched.