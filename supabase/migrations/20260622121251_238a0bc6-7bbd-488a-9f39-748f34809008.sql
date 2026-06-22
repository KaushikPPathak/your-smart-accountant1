ALTER TABLE public.voucher_export_details
  ADD COLUMN IF NOT EXISTS consignee_gstin TEXT,
  ADD COLUMN IF NOT EXISTS buyer_gstin TEXT;