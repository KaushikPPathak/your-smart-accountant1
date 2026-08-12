
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS gst_filing_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (gst_filing_frequency IN ('monthly','quarterly'));
