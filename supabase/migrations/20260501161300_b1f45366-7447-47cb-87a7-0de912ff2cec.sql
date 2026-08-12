ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'normal'
  CHECK (mode IN ('normal', 'trial_local'));