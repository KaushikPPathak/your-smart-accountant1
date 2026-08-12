ALTER TABLE public.gstr2b_lines
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;