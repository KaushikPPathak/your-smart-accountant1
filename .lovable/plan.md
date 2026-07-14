# Step 2 — Use the new compound indexes (zero-risk rollout)

## Goal
Make the hot read paths actually use the v8 compound indexes we added in Step 1, without touching any business logic and without any chance of breaking an existing screen.

## Zero-risk strategy
Three rules, applied to every change:

1. **Never modify an existing query in place.** Add a new fast-path helper next to it. The old query stays as the fallback.
2. **Wrap every fast path in try/catch.** If the index isn't ready yet (e.g. Dexie still upgrading on first load, or a very old browser), we silently fall through to the original query. User sees correct data either way — just slightly slower on that one call.
3. **One call site per step, verified before moving on.** No bulk rewrite.

## Order of work (one small step per turn, you approve each)

### Step 2a — Day Book (safest, most isolated)
- File: `src/routes/app.reports.day-book.tsx` (read-only report, no writes)
- Add fast path using `[company_id+voucher_date]` range query
- Keep existing query as fallback inside try/catch
- Verify: open Day Book, confirm same row count and totals as before
- If anything looks off: fallback triggers automatically, no user impact

### Step 2b — Sales Register
- File: `src/routes/app.reports.sales-register.tsx`
- Uses `[company_id+voucher_type+voucher_date]`
- Same pattern: new helper, try/catch, fallback

### Step 2c — Purchase Register
- File: `src/routes/app.reports.purchase-register.tsx`
- Same index as 2b, same pattern

### Step 2d — Party Ledger
- File: `src/routes/app.reports.ledger.tsx`
- Uses `[company_id+party_id+voucher_date]`

### Step 2e — Trial Balance / ledger balance
- Files: `src/routes/app.reports.trial-balance.tsx` and related
- Uses `[company_id+ledger_id]` on voucher_entries

## What will NOT change
- No schema changes (Step 1 already covered that)
- No changes to voucher save/edit/delete paths
- No changes to sync, backup, restore, outbox
- No changes to any UI component
- No changes to totals, formulas, GST logic, or invariants
- Existing stress test (`stress-10k.test.ts`) must stay green after each sub-step

## Technical detail (safe to skip)
Each fast path is roughly:
```ts
try {
  const rows = await db.cache_vouchers
    .where('[company_id+voucher_date]')
    .between([companyId, fromDate], [companyId, toDate], true, true)
    .toArray();
  if (rows.length >= 0) return rows;  // success — use fast path
} catch {
  // index unavailable — silent fallback
}
// original query, unchanged
return await db.cache_vouchers.where('company_id').equals(companyId).toArray();
```
The old `.where('company_id').equals(...).toArray()` remains present and untouched.

## Verification per sub-step
1. Build passes
2. Stress test passes (`bunx vitest run src/test/stress-10k.test.ts`)
3. You open the affected screen once and confirm numbers match what you saw before

## Start point
Begin with **Step 2a (Day Book)** only. Nothing else touched. If it looks good on your side, we do 2b next turn.
