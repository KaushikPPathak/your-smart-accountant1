-- Enable pgcrypto for credential encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Per-company GST API credentials (Setu GSP + GSTN portal user)
CREATE TABLE public.gst_api_credentials (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'setu', -- future: 'masters_india', 'cygnet', etc.
  environment text NOT NULL DEFAULT 'sandbox', -- 'sandbox' | 'production'
  setu_client_id text,
  setu_client_secret text, -- stored as-is; access restricted to admin via RLS + server-side only
  gstn_username text,
  gstn_password_encrypted bytea, -- pgcrypto symmetric (decrypted in server fn using SUPABASE_SERVICE_ROLE_KEY-derived secret)
  einvoice_enabled boolean NOT NULL DEFAULT false,
  ewaybill_enabled boolean NOT NULL DEFAULT false,
  last_token text,
  last_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gst_api_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins of the company can view/manage credentials
CREATE POLICY gac_select_admin ON public.gst_api_credentials
  FOR SELECT USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE POLICY gac_insert_admin ON public.gst_api_credentials
  FOR INSERT WITH CHECK (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE POLICY gac_update_admin ON public.gst_api_credentials
  FOR UPDATE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE POLICY gac_delete_admin ON public.gst_api_credentials
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE TRIGGER trg_gac_updated_at
  BEFORE UPDATE ON public.gst_api_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log for IRP/EWB API calls
CREATE TABLE public.einvoice_api_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  action text NOT NULL, -- 'generate_irn', 'cancel_irn', 'generate_ewb', 'cancel_ewb'
  request_summary jsonb,
  response_summary jsonb,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.einvoice_api_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY eal_select ON public.einvoice_api_log
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY eal_insert ON public.einvoice_api_log
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));