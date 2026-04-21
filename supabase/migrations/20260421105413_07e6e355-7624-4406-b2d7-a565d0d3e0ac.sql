-- Ledgers: PAN, credit limit, credit days
ALTER TABLE public.ledgers
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS credit_limit_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0;

-- Items: split purchase / sale price, low stock alert
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS purchase_price_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price_paise BIGINT NOT NULL DEFAULT 0;

-- Companies: PAN, bank details, logo
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Vouchers: link to original voucher (for credit/debit notes), reason, vendor invoice meta
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS original_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS place_of_supply_code TEXT,
  ADD COLUMN IF NOT EXISTS round_off_paise BIGINT NOT NULL DEFAULT 0;

-- Company-level invoice/UI settings (1-1 with company)
CREATE TABLE IF NOT EXISTS public.company_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  invoice_starting_number BIGINT NOT NULL DEFAULT 1,
  invoice_footer_note TEXT,
  invoice_terms TEXT,
  show_bank_details BOOLEAN NOT NULL DEFAULT true,
  show_signatory BOOLEAN NOT NULL DEFAULT true,
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select" ON public.company_settings
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "settings_insert" ON public.company_settings
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "settings_update" ON public.company_settings
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "settings_delete" ON public.company_settings
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE TRIGGER update_company_settings_updated_at
BEFORE UPDATE ON public.company_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for company logos (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Company logos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'company-logos');

CREATE POLICY "Members can upload company logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Members can update company logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Members can delete company logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
);

-- Helpful index for outstanding/aging reports
CREATE INDEX IF NOT EXISTS idx_vouchers_company_party_date
  ON public.vouchers (company_id, party_ledger_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_voucher_items_voucher
  ON public.voucher_items (voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_ledger
  ON public.voucher_entries (ledger_id);