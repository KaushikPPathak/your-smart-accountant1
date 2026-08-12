
-- 1. Extend voucher_type enum
ALTER TYPE public.voucher_type ADD VALUE IF NOT EXISTS 'manufacturing';

-- 2. Add row-level specs to voucher_items
ALTER TABLE public.voucher_items ADD COLUMN IF NOT EXISTS specs jsonb;

-- 3. BOM templates
CREATE TABLE IF NOT EXISTS public.bom_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  output_item_id uuid NOT NULL,
  output_qty numeric NOT NULL DEFAULT 1,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bom_templates_company_output_active_uidx
  ON public.bom_templates (company_id, output_item_id) WHERE is_active;

ALTER TABLE public.bom_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY bomt_select ON public.bom_templates FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY bomt_insert ON public.bom_templates FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY bomt_update ON public.bom_templates FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY bomt_delete ON public.bom_templates FOR DELETE
  USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE TRIGGER trg_bom_templates_updated
  BEFORE UPDATE ON public.bom_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. BOM template lines
CREATE TABLE IF NOT EXISTS public.bom_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.bom_templates(id) ON DELETE CASCADE,
  input_item_id uuid NOT NULL,
  qty_per_output numeric NOT NULL DEFAULT 0,
  specs jsonb,
  line_no integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bom_template_lines_template_idx
  ON public.bom_template_lines (template_id);

ALTER TABLE public.bom_template_lines ENABLE ROW LEVEL SECURITY;

-- Lines inherit access from their template's company
CREATE POLICY bomtl_select ON public.bom_template_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.bom_templates t
                  WHERE t.id = template_id
                    AND public.is_company_member(t.company_id, auth.uid())));
CREATE POLICY bomtl_insert ON public.bom_template_lines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.bom_templates t
                       WHERE t.id = template_id
                         AND public.can_write_company(t.company_id, auth.uid())));
CREATE POLICY bomtl_update ON public.bom_template_lines FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.bom_templates t
                  WHERE t.id = template_id
                    AND public.can_write_company(t.company_id, auth.uid())));
CREATE POLICY bomtl_delete ON public.bom_template_lines FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.bom_templates t
                  WHERE t.id = template_id
                    AND public.can_write_company(t.company_id, auth.uid())));
