-- Period locking system for GST returns
-- Once a period is locked (after GSTR-1 / GSTR-3B filing), vouchers in that
-- period cannot be inserted, updated, or deleted without an admin unlock.

CREATE TABLE public.period_locks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  return_type TEXT NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR3B')),
  period TEXT NOT NULL, -- 'YYYY-MM' for monthly, 'YYYY-Qn' for quarterly
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  locked_by UUID NOT NULL,
  filed_reference TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (company_id, return_type, period)
);

CREATE INDEX idx_period_locks_company_active ON public.period_locks (company_id, is_active);
CREATE INDEX idx_period_locks_range ON public.period_locks (company_id, period_start, period_end) WHERE is_active = true;

ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pl_select" ON public.period_locks FOR SELECT
  USING (is_company_member(company_id, auth.uid()));

CREATE POLICY "pl_insert_admin" ON public.period_locks FOR INSERT
  WITH CHECK (has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE POLICY "pl_update_admin" ON public.period_locks FOR UPDATE
  USING (has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE POLICY "pl_delete_admin" ON public.period_locks FOR DELETE
  USING (has_company_role(company_id, auth.uid(), 'admin'::company_role));

CREATE TRIGGER trg_period_locks_updated
  BEFORE UPDATE ON public.period_locks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit trail for unlocks
CREATE TABLE public.period_lock_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  period_lock_id UUID,
  return_type TEXT NOT NULL,
  period TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('lock', 'unlock', 'relock')),
  reason TEXT NOT NULL,
  performed_by UUID NOT NULL,
  performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pla_company ON public.period_lock_audit (company_id, performed_at DESC);

ALTER TABLE public.period_lock_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pla_select" ON public.period_lock_audit FOR SELECT
  USING (is_company_member(company_id, auth.uid()));

CREATE POLICY "pla_insert_admin" ON public.period_lock_audit FOR INSERT
  WITH CHECK (has_company_role(company_id, auth.uid(), 'admin'::company_role));

-- Helper: is the given (company, date) inside an active lock?
CREATE OR REPLACE FUNCTION public.is_period_locked(_company_id UUID, _date DATE)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.period_locks
    WHERE company_id = _company_id
      AND is_active = true
      AND _date BETWEEN period_start AND period_end
  )
$$;

-- Trigger function: block writes on locked-period vouchers
CREATE OR REPLACE FUNCTION public.enforce_period_lock_vouchers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _vdate DATE;
  _company UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _vdate := OLD.voucher_date;
    _company := OLD.company_id;
  ELSE
    _vdate := NEW.voucher_date;
    _company := NEW.company_id;
    -- Also block changing date INTO a locked period
    IF TG_OP = 'UPDATE' AND OLD.voucher_date <> NEW.voucher_date THEN
      IF public.is_period_locked(_company, OLD.voucher_date) THEN
        RAISE EXCEPTION 'Period is locked: voucher dated % cannot be modified. Use a Credit/Debit Note in the current period, or ask an admin to unlock.', OLD.voucher_date
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF public.is_period_locked(_company, _vdate) THEN
    RAISE EXCEPTION 'Period is locked: voucher dated % cannot be added/modified/deleted. Use a Credit/Debit Note in the current period, or ask an admin to unlock.', _vdate
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER trg_enforce_lock_vouchers
  BEFORE INSERT OR UPDATE OR DELETE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_vouchers();

-- For voucher_items / voucher_entries, look up the parent voucher's date
CREATE OR REPLACE FUNCTION public.enforce_period_lock_child()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _vid UUID;
  _vdate DATE;
  _company UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN _vid := OLD.voucher_id; ELSE _vid := NEW.voucher_id; END IF;

  SELECT voucher_date, company_id INTO _vdate, _company
    FROM public.vouchers WHERE id = _vid;

  IF _vdate IS NOT NULL AND public.is_period_locked(_company, _vdate) THEN
    RAISE EXCEPTION 'Period is locked: this voucher (dated %) cannot be modified. Use an amendment voucher instead.', _vdate
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER trg_enforce_lock_vitems
  BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_child();

CREATE TRIGGER trg_enforce_lock_ventries
  BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_child();

-- Convenience RPC: lock a period (admin-only enforced via RLS on insert)
CREATE OR REPLACE FUNCTION public.lock_period(
  _company_id UUID,
  _return_type TEXT,
  _period TEXT,
  _period_start DATE,
  _period_end DATE,
  _filed_reference TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  IF NOT public.has_company_role(_company_id, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Only admins can lock periods';
  END IF;

  INSERT INTO public.period_locks (company_id, return_type, period, period_start, period_end, locked_by, filed_reference, notes, is_active)
  VALUES (_company_id, _return_type, _period, _period_start, _period_end, auth.uid(), _filed_reference, _notes, true)
  ON CONFLICT (company_id, return_type, period)
    DO UPDATE SET is_active = true, locked_at = now(), locked_by = auth.uid(),
                  filed_reference = EXCLUDED.filed_reference, notes = EXCLUDED.notes,
                  period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end
  RETURNING id INTO _id;

  INSERT INTO public.period_lock_audit (company_id, period_lock_id, return_type, period, action, reason, performed_by)
  VALUES (_company_id, _id, _return_type, _period, 'lock', COALESCE(_notes, 'Filed ' || _return_type || ' for ' || _period), auth.uid());

  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_period(
  _company_id UUID,
  _return_type TEXT,
  _period TEXT,
  _reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  IF NOT public.has_company_role(_company_id, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Only admins can unlock periods';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required to unlock a filed period';
  END IF;

  UPDATE public.period_locks
     SET is_active = false, updated_at = now()
   WHERE company_id = _company_id AND return_type = _return_type AND period = _period
   RETURNING id INTO _id;

  IF _id IS NULL THEN
    RAISE EXCEPTION 'No lock found for % %', _return_type, _period;
  END IF;

  INSERT INTO public.period_lock_audit (company_id, period_lock_id, return_type, period, action, reason, performed_by)
  VALUES (_company_id, _id, _return_type, _period, 'unlock', _reason, auth.uid());
END;
$$;