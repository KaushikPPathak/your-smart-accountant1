# Runbook: policy_thresholds migration

Migration: `supabase/migrations/20261122120000_policy_thresholds.sql`.
Adds a nullable `policy_thresholds jsonb` to `public.companies`, backfills every company with the
v1 defaults, and sets the same default for new rows. It does not make the column NOT NULL. Tightening
to NOT NULL is a later migration, once no writer can produce null.

The backfill is idempotent (`WHERE policy_thresholds IS NULL`). Re-running it changes nothing.

## Order

1. **Back up.** Take a fresh logical backup of `public.companies`, or confirm the point-in-time
   recovery window covers the apply. Record the backup id here before continuing.
2. **Staging first** (if a staging project exists). Apply the migration, then run the checks below.
3. **Production.** Apply the same migration. Run the checks again.
4. **Deploy the code only after step 3.** Deploying first is safe, because the null-safe read falls
   back to the defaults, but every device would show the "defaults in use" banner until the schema
   arrives.

## Checks

Run each query after the apply. The expected result is shown beside it.

```sql
-- A. The column exists and is nullable.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'companies' and column_name = 'policy_thresholds';
-- Expected: one row, data_type jsonb, is_nullable YES.

-- B. No company is left without a blob.
select count(*) as companies_without_blob from public.companies where policy_thresholds is null;
-- Expected: 0.

-- C. Every blob is v1 with the agreed defaults. Companies that have since been edited are
--    expected to differ; right after the apply, the count must be 0.
select count(*) as not_default
from public.companies
where policy_thresholds is distinct from
  '{"v":1,"stockAbsPaise":50000,"stockBps":100,"roundOffPaise":100,"advancePaise":100000}'::jsonb;
-- Expected: 0 immediately after the apply.

-- D. Idempotency: the backfill matches nothing once applied.
select count(*) as would_change
from public.companies where policy_thresholds is null;
-- Expected: 0 (same as B).
```

## Who can change thresholds

Writes go through the company save path, and the existing row policy `companies_update_admin` applies:
only a company admin can change them. The migration does not change that policy.

## Rollback

The column is additive. To roll back the app, the previous build ignores the column. To remove it,
drop the column only after confirming no device runs the new build.
