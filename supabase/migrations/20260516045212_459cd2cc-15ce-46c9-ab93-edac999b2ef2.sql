ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS date_format  text NOT NULL DEFAULT 'dd-mm-yyyy';

ALTER TABLE public.companies
  ADD CONSTRAINT companies_date_format_chk
  CHECK (date_format IN ('dd-mm-yyyy','dd/mm/yyyy','mm-dd-yyyy','mm/dd/yyyy','yyyy-mm-dd','dd-mmm-yyyy'));