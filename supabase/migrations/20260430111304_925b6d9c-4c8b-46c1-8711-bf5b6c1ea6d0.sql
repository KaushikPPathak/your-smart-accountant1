ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS annual_turnover_paise BIGINT NOT NULL DEFAULT 0;