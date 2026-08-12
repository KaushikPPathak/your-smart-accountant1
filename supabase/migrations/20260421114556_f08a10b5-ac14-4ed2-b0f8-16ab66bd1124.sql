
-- Default T&C for new settings rows
ALTER TABLE public.company_settings
  ALTER COLUMN invoice_terms SET DEFAULT
'1. Goods once sold will not be taken back or exchanged.
2. Payment due within the agreed credit period; interest @18% p.a. will be charged on overdue amounts.
3. All disputes are subject to local jurisdiction only.
4. Our responsibility ceases the moment goods leave our premises.
5. Please check goods at the time of delivery; no claims thereafter.
6. E. & O.E. (Errors and Omissions Excepted).';

-- Auto-create a settings row for every new company
CREATE OR REPLACE FUNCTION public.handle_new_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_settings (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_settings_seed ON public.companies;
CREATE TRIGGER trg_company_settings_seed
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.handle_new_company_settings();
