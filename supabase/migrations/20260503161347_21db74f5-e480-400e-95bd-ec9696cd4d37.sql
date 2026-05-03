
-- Custom sub-groups under built-in Balance Sheet/P&L groups
CREATE TABLE public.account_subgroups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  parent_group_code text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (company_id, parent_group_code, name)
);
CREATE INDEX idx_account_subgroups_company ON public.account_subgroups(company_id, parent_group_code);

ALTER TABLE public.account_subgroups ENABLE ROW LEVEL SECURITY;

CREATE POLICY asg_select ON public.account_subgroups FOR SELECT
  USING (is_company_member(company_id, auth.uid()));
CREATE POLICY asg_insert ON public.account_subgroups FOR INSERT
  WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY asg_update ON public.account_subgroups FOR UPDATE
  USING (can_write_company(company_id, auth.uid()));
CREATE POLICY asg_delete ON public.account_subgroups FOR DELETE
  USING (can_write_company(company_id, auth.uid()));

CREATE TRIGGER trg_account_subgroups_updated
  BEFORE UPDATE ON public.account_subgroups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-company label overrides for built-in group codes
CREATE TABLE public.account_group_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  group_code text NOT NULL,
  label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (company_id, group_code)
);
ALTER TABLE public.account_group_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY ago_select ON public.account_group_overrides FOR SELECT
  USING (is_company_member(company_id, auth.uid()));
CREATE POLICY ago_insert ON public.account_group_overrides FOR INSERT
  WITH CHECK (can_write_company(company_id, auth.uid()));
CREATE POLICY ago_update ON public.account_group_overrides FOR UPDATE
  USING (can_write_company(company_id, auth.uid()));
CREATE POLICY ago_delete ON public.account_group_overrides FOR DELETE
  USING (can_write_company(company_id, auth.uid()));

CREATE TRIGGER trg_account_group_overrides_updated
  BEFORE UPDATE ON public.account_group_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tag ledgers to a custom subgroup (optional)
ALTER TABLE public.ledgers
  ADD COLUMN subgroup_id uuid REFERENCES public.account_subgroups(id) ON DELETE SET NULL;
CREATE INDEX idx_ledgers_subgroup ON public.ledgers(subgroup_id);
