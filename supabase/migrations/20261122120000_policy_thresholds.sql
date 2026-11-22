-- Company-level policy thresholds (5.4 count variance, 6.5 round-off and advance notice).
-- One versioned JSON object per company so new thresholds are a schema-free addition.
-- Money is in paise and rates in basis points, matching the rest of the schema.
-- Version 1: {"v":1,"stockAbsPaise":50000,"stockBps":100,"roundOffPaise":100,"advancePaise":100000}
-- The company record is the authority; desktop and offline caches mirror it and never edit it.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS policy_thresholds jsonb;

-- Backfill: every existing company gets the agreed defaults, so no row is left null.
UPDATE public.companies
SET policy_thresholds = '{"v":1,"stockAbsPaise":50000,"stockBps":100,"roundOffPaise":100,"advancePaise":100000}'::jsonb
WHERE policy_thresholds IS NULL;

-- New companies get the same defaults without an explicit value.
ALTER TABLE public.companies
  ALTER COLUMN policy_thresholds SET DEFAULT '{"v":1,"stockAbsPaise":50000,"stockBps":100,"roundOffPaise":100,"advancePaise":100000}'::jsonb;
