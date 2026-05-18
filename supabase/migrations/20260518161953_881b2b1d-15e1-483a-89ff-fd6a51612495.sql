
-- Track import batches for undo/bulk-delete
CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'tally_busy',
  label TEXT,
  file_name TEXT,
  ledgers_created INTEGER NOT NULL DEFAULT 0,
  items_created INTEGER NOT NULL DEFAULT 0,
  vouchers_created INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY ib_select ON public.import_batches FOR SELECT USING (is_company_member(company_id, auth.uid()));
CREATE POLICY ib_insert ON public.import_batches FOR INSERT WITH CHECK (can_write_company(company_id, auth.uid()) AND auth.uid() = created_by);
CREATE POLICY ib_update ON public.import_batches FOR UPDATE USING (can_write_company(company_id, auth.uid()));
CREATE POLICY ib_delete ON public.import_batches FOR DELETE USING (has_company_role(company_id, auth.uid(), 'admin'::company_role));

-- Tag rows produced by an import batch
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE public.ledgers  ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE public.items    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_vouchers_import_batch ON public.vouchers(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledgers_import_batch  ON public.ledgers(import_batch_id)  WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_import_batch    ON public.items(import_batch_id)    WHERE import_batch_id IS NOT NULL;

-- Cascade-on-batch delete: when a batch is deleted, clear the tag from rows
-- (we don't auto-delete rows; explicit delete RPC handles that).

-- RPC: bulk delete everything attributed to an import batch (admin-only)
CREATE OR REPLACE FUNCTION public.delete_import_batch(_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company UUID;
  _v INT := 0; _l INT := 0; _i INT := 0;
BEGIN
  SELECT company_id INTO _company FROM public.import_batches WHERE id = _batch_id;
  IF _company IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF NOT public.has_company_role(_company, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Only admins can delete an import batch';
  END IF;

  -- Delete dependent voucher children first
  DELETE FROM public.voucher_entries
   WHERE voucher_id IN (SELECT id FROM public.vouchers WHERE import_batch_id = _batch_id);
  DELETE FROM public.voucher_items
   WHERE voucher_id IN (SELECT id FROM public.vouchers WHERE import_batch_id = _batch_id);
  DELETE FROM public.bill_allocations
   WHERE invoice_voucher_id IN (SELECT id FROM public.vouchers WHERE import_batch_id = _batch_id)
      OR payment_voucher_id IN (SELECT id FROM public.vouchers WHERE import_batch_id = _batch_id);

  WITH d AS (DELETE FROM public.vouchers WHERE import_batch_id = _batch_id RETURNING 1)
  SELECT count(*) INTO _v FROM d;

  WITH d AS (DELETE FROM public.items WHERE import_batch_id = _batch_id RETURNING 1)
  SELECT count(*) INTO _i FROM d;

  WITH d AS (DELETE FROM public.ledgers WHERE import_batch_id = _batch_id RETURNING 1)
  SELECT count(*) INTO _l FROM d;

  DELETE FROM public.import_batches WHERE id = _batch_id;

  RETURN jsonb_build_object('vouchers', _v, 'items', _i, 'ledgers', _l);
END;
$$;

-- RPC: bulk delete vouchers by type + optional date range (admin-only)
CREATE OR REPLACE FUNCTION public.delete_vouchers_bulk(
  _company_id UUID,
  _voucher_type voucher_type,
  _from_date DATE DEFAULT NULL,
  _to_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n INT := 0;
BEGIN
  IF NOT public.has_company_role(_company_id, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Only admins can bulk-delete vouchers';
  END IF;

  DELETE FROM public.voucher_entries
   WHERE voucher_id IN (
     SELECT id FROM public.vouchers
      WHERE company_id = _company_id AND voucher_type = _voucher_type
        AND (_from_date IS NULL OR voucher_date >= _from_date)
        AND (_to_date IS NULL OR voucher_date <= _to_date)
   );
  DELETE FROM public.voucher_items
   WHERE voucher_id IN (
     SELECT id FROM public.vouchers
      WHERE company_id = _company_id AND voucher_type = _voucher_type
        AND (_from_date IS NULL OR voucher_date >= _from_date)
        AND (_to_date IS NULL OR voucher_date <= _to_date)
   );
  DELETE FROM public.bill_allocations
   WHERE company_id = _company_id
     AND (invoice_voucher_id IN (
            SELECT id FROM public.vouchers
             WHERE company_id = _company_id AND voucher_type = _voucher_type
               AND (_from_date IS NULL OR voucher_date >= _from_date)
               AND (_to_date IS NULL OR voucher_date <= _to_date))
       OR payment_voucher_id IN (
            SELECT id FROM public.vouchers
             WHERE company_id = _company_id AND voucher_type = _voucher_type
               AND (_from_date IS NULL OR voucher_date >= _from_date)
               AND (_to_date IS NULL OR voucher_date <= _to_date)));

  WITH d AS (
    DELETE FROM public.vouchers
     WHERE company_id = _company_id AND voucher_type = _voucher_type
       AND (_from_date IS NULL OR voucher_date >= _from_date)
       AND (_to_date IS NULL OR voucher_date <= _to_date)
     RETURNING 1
  )
  SELECT count(*) INTO _n FROM d;

  RETURN _n;
END;
$$;
