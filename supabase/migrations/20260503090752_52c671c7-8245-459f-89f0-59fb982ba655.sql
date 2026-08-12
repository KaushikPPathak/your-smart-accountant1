-- Phase 1: Entity status + entity members for accounting module

-- 1) Enum for entity status
DO $$ BEGIN
  CREATE TYPE public.entity_status AS ENUM (
    'individual',
    'huf',
    'aop',
    'pvt_ltd',
    'registered_firm',
    'trust'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Add columns to companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS entity_status public.entity_status NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS cin TEXT,
  ADD COLUMN IF NOT EXISTS share_capital_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corpus_fund_paise BIGINT NOT NULL DEFAULT 0;

-- 3) Entity members (directors, partners, trustees, karta, etc.)
CREATE TABLE IF NOT EXISTS public.entity_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  member_role TEXT NOT NULL,            -- 'director' | 'partner' | 'trustee' | 'karta' | 'coparcener' | 'member'
  full_name TEXT NOT NULL,
  designation TEXT,
  pan TEXT,
  din TEXT,                              -- Director Identification Number (Pvt Ltd)
  aadhaar_last4 TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  share_percent NUMERIC(7,4) NOT NULL DEFAULT 0,    -- Pvt Ltd shareholding %
  profit_sharing_ratio NUMERIC(7,4) NOT NULL DEFAULT 0, -- RF PSR %
  capital_contribution_paise BIGINT NOT NULL DEFAULT 0,
  appointed_on DATE,
  resigned_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_members_company ON public.entity_members(company_id);

ALTER TABLE public.entity_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS em_select ON public.entity_members;
DROP POLICY IF EXISTS em_insert ON public.entity_members;
DROP POLICY IF EXISTS em_update ON public.entity_members;
DROP POLICY IF EXISTS em_delete ON public.entity_members;

CREATE POLICY em_select ON public.entity_members
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY em_insert ON public.entity_members
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY em_update ON public.entity_members
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY em_delete ON public.entity_members
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));

DROP TRIGGER IF EXISTS trg_entity_members_updated_at ON public.entity_members;
CREATE TRIGGER trg_entity_members_updated_at
  BEFORE UPDATE ON public.entity_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();