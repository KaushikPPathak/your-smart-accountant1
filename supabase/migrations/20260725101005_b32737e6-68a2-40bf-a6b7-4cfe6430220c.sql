
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS borrowings_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nce_level SMALLINT,
  ADD COLUMN IF NOT EXISTS nce_level_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS presumptive_scheme TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS presumptive_mode TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_presumptive_scheme_chk') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_presumptive_scheme_chk
      CHECK (presumptive_scheme IN ('none','44ad','44ada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_presumptive_mode_chk') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_presumptive_mode_chk
      CHECK (presumptive_mode IS NULL OR presumptive_mode IN ('digital','cash','professional'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_nce_level_chk') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_nce_level_chk
      CHECK (nce_level IS NULL OR nce_level IN (1,2,3));
  END IF;
END $$;
