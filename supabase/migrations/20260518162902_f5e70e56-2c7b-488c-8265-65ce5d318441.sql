
DO $$ BEGIN
  CREATE TYPE public.itc_class AS ENUM ('inputs', 'capital_goods', 'input_services', 'ineligible', 'na');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS itc_class public.itc_class NOT NULL DEFAULT 'na',
  ADD COLUMN IF NOT EXISTS itc_eligible BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_vouchers_itc_class
  ON public.vouchers(company_id, itc_class)
  WHERE voucher_type IN ('purchase','debit_note','journal');
