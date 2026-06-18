
-- 1. Row-level invariants on voucher_items (table is empty so we can validate)
ALTER TABLE public.voucher_items
  ADD CONSTRAINT voucher_items_taxable_math
    CHECK (taxable_paise = amount_paise - discount_paise);
ALTER TABLE public.voucher_items
  ADD CONSTRAINT voucher_items_cgst_eq_sgst
    CHECK (cgst_paise = sgst_paise);
ALTER TABLE public.voucher_items
  ADD CONSTRAINT voucher_items_gst_split
    CHECK ((igst_paise = 0) OR (cgst_paise = 0 AND sgst_paise = 0));
ALTER TABLE public.voucher_items
  ADD CONSTRAINT voucher_items_nonneg
    CHECK (qty > 0 AND rate_paise >= 0 AND discount_paise >= 0
           AND taxable_paise >= 0 AND cgst_paise >= 0
           AND sgst_paise >= 0 AND igst_paise >= 0);

-- 2. Per-voucher double-entry balance triggers
CREATE OR REPLACE FUNCTION public.enforce_voucher_balance_ins() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT voucher_id, SUM(debit_paise)::bigint dr, SUM(credit_paise)::bigint cr
      FROM public.voucher_entries
     WHERE voucher_id IN (SELECT DISTINCT voucher_id FROM new_rows)
    GROUP BY voucher_id
  LOOP
    IF r.dr <> r.cr THEN
      RAISE EXCEPTION 'Voucher % unbalanced: Dr=% Cr=% diff=%',
        r.voucher_id, r.dr, r.cr, (r.dr - r.cr)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_voucher_balance_upd() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT voucher_id, SUM(debit_paise)::bigint dr, SUM(credit_paise)::bigint cr
      FROM public.voucher_entries
     WHERE voucher_id IN (
       SELECT DISTINCT voucher_id FROM new_rows
       UNION SELECT DISTINCT voucher_id FROM old_rows)
    GROUP BY voucher_id
  LOOP
    IF r.dr <> r.cr THEN
      RAISE EXCEPTION 'Voucher % unbalanced: Dr=% Cr=% diff=%',
        r.voucher_id, r.dr, r.cr, (r.dr - r.cr)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_voucher_balance_del() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT voucher_id, SUM(debit_paise)::bigint dr, SUM(credit_paise)::bigint cr
      FROM public.voucher_entries
     WHERE voucher_id IN (SELECT DISTINCT voucher_id FROM old_rows)
    GROUP BY voucher_id
  LOOP
    IF r.dr <> r.cr THEN
      RAISE EXCEPTION 'Voucher % unbalanced after delete: Dr=% Cr=%',
        r.voucher_id, r.dr, r.cr USING ERRCODE='check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_voucher_balance_ins ON public.voucher_entries;
CREATE TRIGGER trg_voucher_balance_ins
AFTER INSERT ON public.voucher_entries
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_voucher_balance_ins();

DROP TRIGGER IF EXISTS trg_voucher_balance_upd ON public.voucher_entries;
CREATE TRIGGER trg_voucher_balance_upd
AFTER UPDATE ON public.voucher_entries
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_voucher_balance_upd();

DROP TRIGGER IF EXISTS trg_voucher_balance_del ON public.voucher_entries;
CREATE TRIGGER trg_voucher_balance_del
AFTER DELETE ON public.voucher_entries
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_voucher_balance_del();

-- 3. Item-vs-header totals reconciliation
CREATE OR REPLACE FUNCTION public.enforce_item_header_totals(_vids uuid[])
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT v.id, v.subtotal_paise, v.cgst_paise, v.sgst_paise, v.igst_paise,
           v.round_off_paise, v.total_paise,
           COALESCE(SUM(vi.taxable_paise),0)::bigint sum_tax,
           COALESCE(SUM(vi.cgst_paise),0)::bigint    sum_c,
           COALESCE(SUM(vi.sgst_paise),0)::bigint    sum_s,
           COALESCE(SUM(vi.igst_paise),0)::bigint    sum_i
      FROM public.vouchers v
      LEFT JOIN public.voucher_items vi ON vi.voucher_id = v.id
     WHERE v.id = ANY(_vids)
       AND v.voucher_type IN ('sales','purchase','credit_note','debit_note',
                              'sales_order','delivery_note','quotation','manufacturing')
     GROUP BY v.id
  LOOP
    IF abs(r.sum_tax - r.subtotal_paise) > 1 THEN
      RAISE EXCEPTION 'Voucher %: item subtotal % <> header subtotal %',
        r.id, r.sum_tax, r.subtotal_paise USING ERRCODE='check_violation';
    END IF;
    IF abs(r.sum_c - r.cgst_paise) > 1 OR abs(r.sum_s - r.sgst_paise) > 1
       OR abs(r.sum_i - r.igst_paise) > 1 THEN
      RAISE EXCEPTION 'Voucher %: item GST (C=% S=% I=%) <> header (C=% S=% I=%)',
        r.id, r.sum_c, r.sum_s, r.sum_i, r.cgst_paise, r.sgst_paise, r.igst_paise
        USING ERRCODE='check_violation';
    END IF;
    IF (r.subtotal_paise + r.cgst_paise + r.sgst_paise + r.igst_paise + r.round_off_paise) <> r.total_paise THEN
      RAISE EXCEPTION 'Voucher %: subtotal+taxes+roundoff (%) <> total (%)',
        r.id,
        r.subtotal_paise + r.cgst_paise + r.sgst_paise + r.igst_paise + r.round_off_paise,
        r.total_paise USING ERRCODE='check_violation';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_item_totals_ins() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.enforce_item_header_totals(ARRAY(SELECT DISTINCT voucher_id FROM new_rows));
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.trg_item_totals_upd() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.enforce_item_header_totals(
    ARRAY(SELECT DISTINCT voucher_id FROM new_rows
          UNION SELECT DISTINCT voucher_id FROM old_rows));
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.trg_item_totals_del() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.enforce_item_header_totals(ARRAY(SELECT DISTINCT voucher_id FROM old_rows));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_item_totals_ins ON public.voucher_items;
CREATE TRIGGER trg_item_totals_ins AFTER INSERT ON public.voucher_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_item_totals_ins();

DROP TRIGGER IF EXISTS trg_item_totals_upd ON public.voucher_items;
CREATE TRIGGER trg_item_totals_upd AFTER UPDATE ON public.voucher_items
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_item_totals_upd();

DROP TRIGGER IF EXISTS trg_item_totals_del ON public.voucher_items;
CREATE TRIGGER trg_item_totals_del AFTER DELETE ON public.voucher_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_item_totals_del();

-- 4. Atomic save RPC: header + entries + items in ONE transaction
CREATE OR REPLACE FUNCTION public.save_voucher_atomic(
  _header jsonb, _entries jsonb DEFAULT '[]'::jsonb, _items jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _vid uuid;
  _company uuid := (_header->>'company_id')::uuid;
BEGIN
  IF NOT public.can_write_company(_company, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.vouchers (
    company_id, voucher_type, voucher_number, voucher_date,
    party_ledger_id, reference_no, narration,
    subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise,
    is_interstate, place_of_supply_code, vendor_invoice_no, vendor_invoice_date,
    due_date, itc_class, itc_eligible, supply_nature, created_by
  ) VALUES (
    _company,
    (_header->>'voucher_type')::voucher_type,
    _header->>'voucher_number',
    (_header->>'voucher_date')::date,
    NULLIF(_header->>'party_ledger_id','')::uuid,
    _header->>'reference_no',
    _header->>'narration',
    COALESCE((_header->>'subtotal_paise')::bigint,0),
    COALESCE((_header->>'cgst_paise')::bigint,0),
    COALESCE((_header->>'sgst_paise')::bigint,0),
    COALESCE((_header->>'igst_paise')::bigint,0),
    COALESCE((_header->>'round_off_paise')::bigint,0),
    COALESCE((_header->>'total_paise')::bigint,0),
    COALESCE((_header->>'is_interstate')::boolean,false),
    _header->>'place_of_supply_code',
    _header->>'vendor_invoice_no',
    NULLIF(_header->>'vendor_invoice_date','')::date,
    NULLIF(_header->>'due_date','')::date,
    COALESCE((_header->>'itc_class')::itc_class,'na'::itc_class),
    COALESCE((_header->>'itc_eligible')::boolean,true),
    COALESCE((_header->>'supply_nature')::supply_nature,'taxable'::supply_nature),
    auth.uid()
  ) RETURNING id INTO _vid;

  IF jsonb_array_length(_items) > 0 THEN
    INSERT INTO public.voucher_items
      (voucher_id, item_id, description, qty, rate_paise, discount_paise,
       taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, amount_paise, line_no)
    SELECT _vid,
           (e->>'item_id')::uuid, e->>'description',
           (e->>'qty')::numeric,
           COALESCE((e->>'rate_paise')::bigint,0),
           COALESCE((e->>'discount_paise')::bigint,0),
           COALESCE((e->>'taxable_paise')::bigint,0),
           COALESCE((e->>'gst_rate')::numeric,0),
           COALESCE((e->>'cgst_paise')::bigint,0),
           COALESCE((e->>'sgst_paise')::bigint,0),
           COALESCE((e->>'igst_paise')::bigint,0),
           COALESCE((e->>'amount_paise')::bigint,0),
           COALESCE((e->>'line_no')::int,1)
      FROM jsonb_array_elements(_items) e;
  END IF;

  IF jsonb_array_length(_entries) > 0 THEN
    INSERT INTO public.voucher_entries
      (voucher_id, ledger_id, debit_paise, credit_paise, narration, line_no)
    SELECT _vid,
           (e->>'ledger_id')::uuid,
           COALESCE((e->>'debit_paise')::bigint,0),
           COALESCE((e->>'credit_paise')::bigint,0),
           e->>'narration',
           COALESCE((e->>'line_no')::int,1)
      FROM jsonb_array_elements(_entries) e;
  END IF;

  RETURN _vid;
END $$;

GRANT EXECUTE ON FUNCTION public.save_voucher_atomic(jsonb,jsonb,jsonb) TO authenticated;
