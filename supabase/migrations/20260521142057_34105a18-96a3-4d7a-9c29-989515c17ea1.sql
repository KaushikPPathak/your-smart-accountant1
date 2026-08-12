
-- Sync opening balances of the active FY against closing of prior period.
-- Compares ledgers + items as-of (_fy_start - 1) and overwrites the opening
-- on the same row only when a mismatch is found. Returns a JSON summary.

CREATE OR REPLACE FUNCTION public.sync_opening_balances_from_previous_fy(
  _company_id uuid,
  _fy_start date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ledger_updates  jsonb := '[]'::jsonb;
  _item_updates    jsonb := '[]'::jsonb;
  _ledger_count    int := 0;
  _item_count      int := 0;
  _inv_enabled     boolean := false;
  _r               record;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _fy_start IS NULL THEN
    RAISE EXCEPTION 'Financial year start required';
  END IF;

  SELECT inventory_enabled INTO _inv_enabled FROM public.companies WHERE id = _company_id;

  -- Ledger sync: closing-as-of-prior-FY = signed_opening + sum(dr - cr) for voucher_date < _fy_start
  FOR _r IN
    WITH movements AS (
      SELECT ve.ledger_id,
             SUM(ve.debit_paise - ve.credit_paise)::bigint AS net
      FROM public.voucher_entries ve
      JOIN public.vouchers v ON v.id = ve.voucher_id
      WHERE v.company_id = _company_id
        AND v.voucher_date < _fy_start
      GROUP BY ve.ledger_id
    ),
    computed AS (
      SELECT l.id,
             l.name,
             l.opening_balance_paise,
             l.opening_balance_is_debit,
             ( (CASE WHEN l.opening_balance_is_debit THEN 1 ELSE -1 END) * l.opening_balance_paise
               + COALESCE(m.net, 0) ) AS signed_closing
      FROM public.ledgers l
      LEFT JOIN movements m ON m.ledger_id = l.id
      WHERE l.company_id = _company_id
        AND l.is_active = true
        -- Skip P&L-nature ledgers; they roll into retained earnings, not into the new opening.
        AND l.type NOT IN ('expense_direct','expense_indirect','income_direct','income_indirect')
    )
    SELECT id, name,
           opening_balance_paise AS old_paise,
           opening_balance_is_debit AS old_is_debit,
           ABS(signed_closing)::bigint AS new_paise,
           (signed_closing >= 0) AS new_is_debit
    FROM computed
    WHERE ABS(signed_closing) <> opening_balance_paise
       OR ( (signed_closing >= 0) <> opening_balance_is_debit AND signed_closing <> 0 )
  LOOP
    UPDATE public.ledgers
       SET opening_balance_paise = _r.new_paise,
           opening_balance_is_debit = _r.new_is_debit,
           updated_at = now()
     WHERE id = _r.id;

    _ledger_updates := _ledger_updates || jsonb_build_object(
      'ledger_id', _r.id,
      'name', _r.name,
      'old_paise', _r.old_paise,
      'old_is_debit', _r.old_is_debit,
      'new_paise', _r.new_paise,
      'new_is_debit', _r.new_is_debit
    );
    _ledger_count := _ledger_count + 1;
  END LOOP;

  -- Item / stock sync — only when inventory is enabled for this company
  IF _inv_enabled THEN
    FOR _r IN
      WITH moves AS (
        SELECT vi.item_id,
               v.voucher_type,
               vi.qty,
               vi.rate_paise
        FROM public.voucher_items vi
        JOIN public.vouchers v ON v.id = vi.voucher_id
        WHERE v.company_id = _company_id
          AND v.voucher_date < _fy_start
      ),
      agg AS (
        SELECT i.id,
               i.name,
               i.opening_stock_qty,
               i.opening_stock_rate_paise,
               i.opening_stock_qty
                 + COALESCE(SUM(
                     CASE
                       WHEN m.voucher_type = 'manufacturing' THEN m.qty
                       WHEN m.voucher_type IN ('purchase','credit_note') THEN ABS(m.qty)
                       WHEN m.voucher_type IN ('sales','debit_note') THEN -ABS(m.qty)
                       ELSE 0
                     END
                   ), 0) AS new_qty,
               COALESCE(
                 (SELECT rate_paise FROM moves m2
                   WHERE m2.item_id = i.id
                     AND ( m2.voucher_type IN ('purchase','credit_note')
                        OR (m2.voucher_type = 'manufacturing' AND m2.qty > 0) )
                     AND m2.rate_paise > 0
                   ORDER BY 1 DESC LIMIT 1),
                 i.opening_stock_rate_paise
               ) AS new_rate
        FROM public.items i
        LEFT JOIN moves m ON m.item_id = i.id
        WHERE i.company_id = _company_id
          AND i.is_active = true
        GROUP BY i.id
      )
      SELECT id, name,
             opening_stock_qty AS old_qty,
             opening_stock_rate_paise AS old_rate,
             new_qty,
             new_rate
      FROM agg
      WHERE new_qty <> opening_stock_qty
         OR (new_rate <> opening_stock_rate_paise AND new_qty <> 0)
    LOOP
      UPDATE public.items
         SET opening_stock_qty = _r.new_qty,
             opening_stock_rate_paise = _r.new_rate,
             updated_at = now()
       WHERE id = _r.id;

      _item_updates := _item_updates || jsonb_build_object(
        'item_id', _r.id,
        'name', _r.name,
        'old_qty', _r.old_qty,
        'old_rate_paise', _r.old_rate,
        'new_qty', _r.new_qty,
        'new_rate_paise', _r.new_rate
      );
      _item_count := _item_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ledgers_updated', _ledger_count,
    'items_updated', _item_count,
    'ledger_details', _ledger_updates,
    'item_details', _item_updates,
    'fy_start', _fy_start
  );
END;
$$;
