-- 1) Ledger GST treatment for parties (used by GSTR-1 to route invoices)
DO $$ BEGIN
  CREATE TYPE public.gst_treatment AS ENUM (
    'regular',          -- normal B2B/B2C
    'composition',      -- composition dealer
    'unregistered',     -- B2C / unregistered customer
    'consumer',         -- end consumer
    'sez_with_payment', -- SEZ supply with IGST payment
    'sez_without_payment',
    'overseas',         -- export
    'deemed_export',
    'uin_holder'        -- embassies / UN
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.ledgers
  ADD COLUMN IF NOT EXISTS gst_treatment public.gst_treatment NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS country TEXT;

-- 2) Voucher-level supply nature for GSTR-1/3B classification
DO $$ BEGIN
  CREATE TYPE public.supply_nature AS ENUM (
    'taxable',          -- 3.1(a)
    'zero_rated_wp',    -- export/SEZ WITH payment of IGST  → 3.1(b)
    'zero_rated_wop',   -- export/SEZ WITHOUT payment (LUT)  → 3.1(b)
    'nil_rated',        -- 3.1(c)
    'exempt',           -- 3.1(c)
    'non_gst',          -- 3.1(e)
    'rcm_inward',       -- 3.1(d)  inward liable to RCM
    'deemed_export'     -- DEXP
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS supply_nature public.supply_nature NOT NULL DEFAULT 'taxable',
  ADD COLUMN IF NOT EXISTS shipping_bill_no TEXT,
  ADD COLUMN IF NOT EXISTS shipping_bill_date DATE,
  ADD COLUMN IF NOT EXISTS port_code TEXT,
  -- For amendments referencing the originally filed invoice/note
  ADD COLUMN IF NOT EXISTS is_amendment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS orig_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS orig_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS orig_period TEXT;  -- "MMYYYY"

-- 3) Inward supplies summary for 3B section 5 (composition/exempt/nil/non-GST inward)
CREATE TABLE IF NOT EXISTS public.gstr3b_inward_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                -- "MMYYYY"
  ty TEXT NOT NULL CHECK (ty IN ('GST','NONGST')),
  inter_paise BIGINT NOT NULL DEFAULT 0,
  intra_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period, ty)
);

ALTER TABLE public.gstr3b_inward_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read inward summary" ON public.gstr3b_inward_summary
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "writers can upsert inward summary insert" ON public.gstr3b_inward_summary
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "writers can upsert inward summary update" ON public.gstr3b_inward_summary
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "writers can delete inward summary" ON public.gstr3b_inward_summary
  FOR DELETE USING (public.can_write_company(company_id, auth.uid()));

-- 4) ITC reversal lines (3B 4(B)) per period
CREATE TABLE IF NOT EXISTS public.gstr3b_itc_reversal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  ty TEXT NOT NULL CHECK (ty IN ('RUL','OTH')),  -- Rule 42/43 vs Others
  iamt_paise BIGINT NOT NULL DEFAULT 0,
  camt_paise BIGINT NOT NULL DEFAULT 0,
  samt_paise BIGINT NOT NULL DEFAULT 0,
  csamt_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period, ty)
);

ALTER TABLE public.gstr3b_itc_reversal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read itc reversal" ON public.gstr3b_itc_reversal
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "writers insert itc reversal" ON public.gstr3b_itc_reversal
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "writers update itc reversal" ON public.gstr3b_itc_reversal
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "writers delete itc reversal" ON public.gstr3b_itc_reversal
  FOR DELETE USING (public.can_write_company(company_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_vouchers_supply_nature ON public.vouchers(company_id, supply_nature, voucher_date);
CREATE INDEX IF NOT EXISTS idx_ledgers_gst_treatment ON public.ledgers(company_id, gst_treatment);