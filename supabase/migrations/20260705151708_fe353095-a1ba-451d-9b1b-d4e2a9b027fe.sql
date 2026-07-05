-- 1. Add soft-delete marker + index to each user-facing cached table.
ALTER TABLE public.ledgers                   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.items                     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.vouchers                  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.account_subgroups         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.ledger_group_mappings     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.account_group_overrides   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_ledgers_active                  ON public.ledgers                 (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_items_active                    ON public.items                   (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_vouchers_active                 ON public.vouchers                (company_id, voucher_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_account_subgroups_active        ON public.account_subgroups       (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_group_mappings_active    ON public.ledger_group_mappings   (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_account_group_overrides_active  ON public.account_group_overrides (company_id) WHERE deleted_at IS NULL;

-- 2. A trigger that keeps updated_at fresh whenever deleted_at changes,
--    so the delta pull sees the tombstone on other devices.
CREATE OR REPLACE FUNCTION public.touch_updated_at_on_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ledgers','items','vouchers','account_subgroups',
    'ledger_group_mappings','account_group_overrides'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_soft_delete ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_soft_delete BEFORE UPDATE ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_on_soft_delete()',
      t
    );
  END LOOP;
END $$;