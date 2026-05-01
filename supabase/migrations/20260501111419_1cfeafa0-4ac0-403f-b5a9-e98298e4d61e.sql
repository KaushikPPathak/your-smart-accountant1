CREATE TABLE public.ledger_group_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  source_name_lc text NOT NULL,
  source_name text NOT NULL,
  group_code text NOT NULL,
  ledger_type text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_name_lc)
);

CREATE INDEX idx_lgm_company ON public.ledger_group_mappings(company_id);

ALTER TABLE public.ledger_group_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lgm_select" ON public.ledger_group_mappings
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "lgm_insert" ON public.ledger_group_mappings
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));

CREATE POLICY "lgm_update" ON public.ledger_group_mappings
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));

CREATE POLICY "lgm_delete" ON public.ledger_group_mappings
  FOR DELETE USING (public.can_write_company(company_id, auth.uid()));

CREATE TRIGGER trg_lgm_updated_at
  BEFORE UPDATE ON public.ledger_group_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();