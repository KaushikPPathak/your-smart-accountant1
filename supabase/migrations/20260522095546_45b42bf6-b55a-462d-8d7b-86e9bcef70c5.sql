
-- Phase 1: Manufacturing Journal extensions
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS processing_overhead_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scrap_value_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process_yield_pct numeric;

ALTER TABLE public.voucher_items
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'output';

-- Phase 2: IT Audit data layer
CREATE TABLE IF NOT EXISTS public.it_asset_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  rate_pct numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
ALTER TABLE public.it_asset_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY itab_sel ON public.it_asset_blocks FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY itab_ins ON public.it_asset_blocks FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY itab_upd ON public.it_asset_blocks FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY itab_del ON public.it_asset_blocks FOR DELETE USING (can_write_company(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.it_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  block_code text NOT NULL,
  ledger_id uuid,
  name text NOT NULL,
  fy_start date NOT NULL,
  opening_wdv_paise bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.it_fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY itfa_sel ON public.it_fixed_assets FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY itfa_ins ON public.it_fixed_assets FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY itfa_upd ON public.it_fixed_assets FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY itfa_del ON public.it_fixed_assets FOR DELETE USING (can_write_company(company_id, auth.uid()));
CREATE INDEX IF NOT EXISTS itfa_company_fy_idx ON public.it_fixed_assets(company_id, fy_start);

CREATE TABLE IF NOT EXISTS public.it_asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.it_fixed_assets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  fy_start date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('addition','deletion')),
  movement_date date NOT NULL,
  amount_paise bigint NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.it_asset_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY itam_sel ON public.it_asset_movements FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY itam_ins ON public.it_asset_movements FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY itam_upd ON public.it_asset_movements FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY itam_del ON public.it_asset_movements FOR DELETE USING (can_write_company(company_id, auth.uid()));
CREATE INDEX IF NOT EXISTS itam_asset_idx ON public.it_asset_movements(asset_id, fy_start);

CREATE TABLE IF NOT EXISTS public.it_43b_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  ledger_id uuid NOT NULL,
  fy_end date NOT NULL,
  cleared_on date,
  cleared_paise bigint NOT NULL DEFAULT 0,
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, ledger_id, fy_end)
);
ALTER TABLE public.it_43b_clearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY it43_sel ON public.it_43b_clearances FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY it43_ins ON public.it_43b_clearances FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY it43_upd ON public.it_43b_clearances FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY it43_del ON public.it_43b_clearances FOR DELETE USING (can_write_company(company_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.it_disallowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  fy_end date NOT NULL,
  section text NOT NULL,
  description text,
  amount_paise bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.it_disallowances ENABLE ROW LEVEL SECURITY;
CREATE POLICY itd_sel ON public.it_disallowances FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY itd_ins ON public.it_disallowances FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY itd_upd ON public.it_disallowances FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY itd_del ON public.it_disallowances FOR DELETE USING (can_write_company(company_id, auth.uid()));
