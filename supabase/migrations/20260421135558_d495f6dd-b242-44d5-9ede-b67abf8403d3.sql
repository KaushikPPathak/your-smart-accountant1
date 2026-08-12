-- 1. Bill allocations: link receipt/payment to invoice
CREATE TABLE public.bill_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  invoice_voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES public.ledgers(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billalloc_invoice ON public.bill_allocations(invoice_voucher_id);
CREATE INDEX idx_billalloc_payment ON public.bill_allocations(payment_voucher_id);
CREATE INDEX idx_billalloc_ledger ON public.bill_allocations(ledger_id);

ALTER TABLE public.bill_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ba_select" ON public.bill_allocations FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "ba_insert" ON public.bill_allocations FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ba_update" ON public.bill_allocations FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ba_delete" ON public.bill_allocations FOR DELETE
  USING (public.can_write_company(company_id, auth.uid()));

-- 2. Add cleared_date + voucher_entry_id to bank_statement_lines for BRS
ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS cleared_date DATE,
  ADD COLUMN IF NOT EXISTS matched_entry_id UUID REFERENCES public.voucher_entries(id) ON DELETE SET NULL;

-- 2b. Add cleared_date directly on voucher_entries so we can reconcile book entries
-- without requiring a statement upload
ALTER TABLE public.voucher_entries
  ADD COLUMN IF NOT EXISTS cleared_date DATE;

CREATE INDEX IF NOT EXISTS idx_ventries_cleared ON public.voucher_entries(ledger_id, cleared_date);

-- 3. GSTR-2B import header + lines
CREATE TABLE public.gstr2b_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- e.g. "042026" (MMYYYY)
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'csv', -- csv | json
  file_name TEXT,
  total_lines INTEGER NOT NULL DEFAULT 0,
  matched_lines INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.gstr2b_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "g2bi_select" ON public.gstr2b_imports FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "g2bi_insert" ON public.gstr2b_imports FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "g2bi_update" ON public.gstr2b_imports FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "g2bi_delete" ON public.gstr2b_imports FOR DELETE
  USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE TABLE public.gstr2b_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  import_id UUID NOT NULL REFERENCES public.gstr2b_imports(id) ON DELETE CASCADE,
  supplier_gstin TEXT NOT NULL,
  supplier_name TEXT,
  invoice_no TEXT NOT NULL,
  invoice_date DATE,
  invoice_value_paise BIGINT NOT NULL DEFAULT 0,
  taxable_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  cess_paise BIGINT NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'unmatched', -- matched | unmatched | mismatch
  matched_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_g2bl_import ON public.gstr2b_lines(import_id);
CREATE INDEX idx_g2bl_match ON public.gstr2b_lines(supplier_gstin, invoice_no);

ALTER TABLE public.gstr2b_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "g2bl_select" ON public.gstr2b_lines FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "g2bl_insert" ON public.gstr2b_lines FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "g2bl_update" ON public.gstr2b_lines FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "g2bl_delete" ON public.gstr2b_lines FOR DELETE
  USING (public.can_write_company(company_id, auth.uid()));

-- 4. Voucher chain: due_date and linked_voucher_ids
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS linked_voucher_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chain_status TEXT NOT NULL DEFAULT 'open'; -- open | partially_invoiced | invoiced | cancelled

CREATE INDEX IF NOT EXISTS idx_vouchers_chain_status ON public.vouchers(company_id, voucher_type, chain_status);
