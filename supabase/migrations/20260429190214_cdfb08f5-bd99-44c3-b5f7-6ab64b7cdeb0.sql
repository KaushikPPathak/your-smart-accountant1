ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS gst_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_filing_frequency text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_gst_filing_frequency_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_gst_filing_frequency_check
  CHECK (gst_filing_frequency IN ('monthly','quarterly','iff'));

-- Backfill: any existing company with a GSTIN is treated as registered
UPDATE public.companies
   SET gst_registered = true
 WHERE gstin IS NOT NULL AND length(trim(gstin)) > 0;