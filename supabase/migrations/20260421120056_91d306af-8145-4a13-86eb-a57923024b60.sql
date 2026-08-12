
-- 1. Extend voucher_type enum for sales workflow
ALTER TYPE public.voucher_type ADD VALUE IF NOT EXISTS 'quotation';
ALTER TYPE public.voucher_type ADD VALUE IF NOT EXISTS 'sales_order';
ALTER TYPE public.voucher_type ADD VALUE IF NOT EXISTS 'delivery_note';

-- 2. Ledger communication preferences
ALTER TABLE public.ledgers
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;

-- 3. Recurring invoice templates
CREATE TABLE IF NOT EXISTS public.recurring_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  voucher_type public.voucher_type NOT NULL DEFAULT 'sales',
  party_ledger_id uuid REFERENCES public.ledgers(id) ON DELETE SET NULL,
  frequency text NOT NULL DEFAULT 'monthly', -- weekly, monthly, quarterly, yearly
  next_run_date date NOT NULL,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  template_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_generated_voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  last_generated_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recurring_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recur_select" ON public.recurring_invoices FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "recur_insert" ON public.recurring_invoices FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "recur_update" ON public.recurring_invoices FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "recur_delete" ON public.recurring_invoices FOR DELETE
  USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE TRIGGER recurring_invoices_updated_at BEFORE UPDATE ON public.recurring_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Bank statement imports
CREATE TABLE IF NOT EXISTS public.bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_ledger_id uuid NOT NULL REFERENCES public.ledgers(id) ON DELETE CASCADE,
  file_name text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid NOT NULL,
  from_date date,
  to_date date,
  total_lines integer NOT NULL DEFAULT 0,
  matched_lines integer NOT NULL DEFAULT 0
);

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bs_select" ON public.bank_statements FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "bs_insert" ON public.bank_statements FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "bs_update" ON public.bank_statements FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "bs_delete" ON public.bank_statements FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  description text,
  reference text,
  debit_paise bigint NOT NULL DEFAULT 0,
  credit_paise bigint NOT NULL DEFAULT 0,
  balance_paise bigint,
  matched_voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched', -- unmatched, suggested, matched, ignored
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bsl_select" ON public.bank_statement_lines FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "bsl_insert" ON public.bank_statement_lines FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "bsl_update" ON public.bank_statement_lines FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "bsl_delete" ON public.bank_statement_lines FOR DELETE USING (public.can_write_company(company_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_bsl_company_date ON public.bank_statement_lines(company_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_bsl_status ON public.bank_statement_lines(match_status);

-- 5. E-Invoice / E-way Bill details
CREATE TABLE IF NOT EXISTS public.einvoice_details (
  voucher_id uuid PRIMARY KEY REFERENCES public.vouchers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  irn text,
  ack_no text,
  ack_date timestamptz,
  signed_qr text,
  signed_invoice text,
  status text NOT NULL DEFAULT 'pending', -- pending, generated, cancelled, failed
  ewb_no text,
  ewb_date timestamptz,
  ewb_valid_until timestamptz,
  transporter_id text,
  transporter_name text,
  vehicle_no text,
  distance_km integer,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.einvoice_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ei_select" ON public.einvoice_details FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "ei_insert" ON public.einvoice_details FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ei_update" ON public.einvoice_details FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ei_delete" ON public.einvoice_details FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE TRIGGER einvoice_updated_at BEFORE UPDATE ON public.einvoice_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Payment reminder log
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES public.ledgers(id) ON DELETE CASCADE,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  channel text NOT NULL, -- email, whatsapp, sms
  status text NOT NULL DEFAULT 'sent', -- sent, failed, queued
  message text,
  sent_by uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_select" ON public.payment_reminders FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "pr_insert" ON public.payment_reminders FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "pr_delete" ON public.payment_reminders FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_pr_company ON public.payment_reminders(company_id, sent_at DESC);

-- 7. Settings extensions for e-invoicing toggle and payment link template
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS einvoice_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ewaybill_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS reminder_template text DEFAULT 'Dear {party}, this is a friendly reminder that invoice {invoice_no} dated {invoice_date} for {amount} is overdue by {days} days. Kindly arrange payment at your earliest. Thank you, {company}.';
