-- =====================================================================
-- 1. Monthly balance snapshot (for fast reports on large data)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.monthly_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  ledger_id UUID NOT NULL,
  period_month DATE NOT NULL,             -- first day of the month (e.g. 2025-04-01)
  opening_paise BIGINT NOT NULL DEFAULT 0,  -- signed: +Dr / -Cr at start of month
  debit_paise BIGINT NOT NULL DEFAULT 0,
  credit_paise BIGINT NOT NULL DEFAULT 0,
  closing_paise BIGINT NOT NULL DEFAULT 0,  -- signed: +Dr / -Cr at end of month
  rebuilt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (company_id, ledger_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_balances_co_month
  ON public.monthly_balances (company_id, period_month);
CREATE INDEX IF NOT EXISTS idx_monthly_balances_ledger
  ON public.monthly_balances (ledger_id, period_month);

ALTER TABLE public.monthly_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY mb_select ON public.monthly_balances FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY mb_insert ON public.monthly_balances FOR INSERT
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY mb_update ON public.monthly_balances FOR UPDATE
  USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY mb_delete ON public.monthly_balances FOR DELETE
  USING (public.can_write_company(company_id, auth.uid()));

-- Rebuild snapshots for one company. Idempotent.
CREATE OR REPLACE FUNCTION public.recompute_monthly_balances(_company_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows INTEGER;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.monthly_balances WHERE company_id = _company_id;

  WITH per_month AS (
    SELECT
      ve.ledger_id,
      date_trunc('month', v.voucher_date)::date AS period_month,
      SUM(ve.debit_paise)::bigint  AS dr,
      SUM(ve.credit_paise)::bigint AS cr
    FROM public.voucher_entries ve
    JOIN public.vouchers v ON v.id = ve.voucher_id
    WHERE v.company_id = _company_id
    GROUP BY ve.ledger_id, date_trunc('month', v.voucher_date)
  ),
  running AS (
    SELECT
      pm.ledger_id,
      pm.period_month,
      pm.dr,
      pm.cr,
      SUM(pm.dr - pm.cr) OVER (
        PARTITION BY pm.ledger_id
        ORDER BY pm.period_month
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prior_movement
    FROM per_month pm
  )
  INSERT INTO public.monthly_balances
    (company_id, ledger_id, period_month, opening_paise, debit_paise, credit_paise, closing_paise)
  SELECT
    _company_id,
    r.ledger_id,
    r.period_month,
    (CASE WHEN l.opening_balance_is_debit THEN 1 ELSE -1 END) * l.opening_balance_paise
      + COALESCE(r.prior_movement, 0)                                             AS opening_paise,
    r.dr,
    r.cr,
    (CASE WHEN l.opening_balance_is_debit THEN 1 ELSE -1 END) * l.opening_balance_paise
      + COALESCE(r.prior_movement, 0) + (r.dr - r.cr)                             AS closing_paise
  FROM running r
  JOIN public.ledgers l ON l.id = r.ledger_id;

  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows;
END;
$$;

-- =====================================================================
-- 2. Year-end closure runs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.closing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  fy_start DATE NOT NULL,
  fy_end DATE NOT NULL,
  closing_stock_paise BIGINT NOT NULL DEFAULT 0,
  trading_voucher_id UUID,
  pl_voucher_id UUID,
  capital_voucher_id UUID,
  closing_stock_voucher_id UUID,
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed' | 'reversed'
  notes TEXT,
  performed_by UUID NOT NULL,
  performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_closing_runs_co_fy
  ON public.closing_runs (company_id, fy_end DESC);

ALTER TABLE public.closing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY cr_select ON public.closing_runs FOR SELECT
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY cr_insert ON public.closing_runs FOR INSERT
  WITH CHECK (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));
CREATE POLICY cr_update ON public.closing_runs FOR UPDATE
  USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));
CREATE POLICY cr_delete ON public.closing_runs FOR DELETE
  USING (public.has_company_role(company_id, auth.uid(), 'admin'::company_role));