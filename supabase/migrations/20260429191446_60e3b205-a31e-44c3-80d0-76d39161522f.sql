ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS inventory_enabled boolean NOT NULL DEFAULT true;

-- Backfill: companies that already have any items get inventory_enabled = true (default already true)
-- Companies with no items remain true so existing flows keep working; users can disable per company.