
-- Audit log for repair actions
CREATE TABLE IF NOT EXISTS public.voucher_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  voucher_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.voucher_repair_audit TO authenticated;
GRANT ALL ON public.voucher_repair_audit TO service_role;
ALTER TABLE public.voucher_repair_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read repair audit"
  ON public.voucher_repair_audit FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "members insert repair audit"
  ON public.voucher_repair_audit FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

-- Repair orphan vouchers by posting balanced Suspense/Party entries
CREATE OR REPLACE FUNCTION public.repair_orphan_vouchers_with_suspense(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _suspense_id uuid;
  _v RECORD;
  _amount bigint;
  _party uuid;
  _repaired int := 0;
  _skipped int := 0;
  _details jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Find or create Suspense Account
  SELECT id INTO _suspense_id FROM public.ledgers
   WHERE company_id = _company_id AND lower(name) = 'suspense account' LIMIT 1;
  IF _suspense_id IS NULL THEN
    INSERT INTO public.ledgers (company_id, name, type, opening_balance_paise, opening_balance_is_debit, is_active)
    VALUES (_company_id, 'Suspense Account', 'current_asset', 0, true, true)
    RETURNING id INTO _suspense_id;
  END IF;

  FOR _v IN
    SELECT v.id, v.voucher_type, v.voucher_number, v.party_ledger_id, v.total_paise,
           COALESCE((SELECT SUM(taxable_paise + cgst_paise + sgst_paise + igst_paise)
                       FROM public.voucher_items WHERE voucher_id = v.id), 0)::bigint AS items_total
      FROM public.vouchers v
     WHERE v.company_id = _company_id
       AND NOT EXISTS (SELECT 1 FROM public.voucher_entries ve WHERE ve.voucher_id = v.id)
  LOOP
    _amount := GREATEST(_v.total_paise, _v.items_total);
    _party  := _v.party_ledger_id;

    IF _amount <= 0 OR _party IS NULL THEN
      _skipped := _skipped + 1;
      _details := _details || jsonb_build_object('voucher_id', _v.id, 'voucher_number', _v.voucher_number,
                              'status', 'skipped', 'reason',
                              CASE WHEN _party IS NULL THEN 'no party ledger' ELSE 'zero amount' END);
      CONTINUE;
    END IF;

    -- Direction: purchase/debit_note/payment ⇒ Dr Suspense, Cr Party
    --             sales/credit_note/receipt   ⇒ Dr Party, Cr Suspense
    IF _v.voucher_type IN ('purchase','debit_note','payment') THEN
      INSERT INTO public.voucher_entries (voucher_id, ledger_id, debit_paise, credit_paise, line_no, narration)
      VALUES (_v.id, _suspense_id, _amount, 0, 1, 'Auto-repair: Suspense (orphan voucher)'),
             (_v.id, _party,       0, _amount, 2, 'Auto-repair: Party');
    ELSIF _v.voucher_type IN ('sales','credit_note','receipt') THEN
      INSERT INTO public.voucher_entries (voucher_id, ledger_id, debit_paise, credit_paise, line_no, narration)
      VALUES (_v.id, _party,       _amount, 0, 1, 'Auto-repair: Party'),
             (_v.id, _suspense_id, 0, _amount, 2, 'Auto-repair: Suspense (orphan voucher)');
    ELSE
      _skipped := _skipped + 1;
      _details := _details || jsonb_build_object('voucher_id', _v.id, 'voucher_number', _v.voucher_number,
                              'status', 'skipped', 'reason', 'unsupported type ' || _v.voucher_type);
      CONTINUE;
    END IF;

    _repaired := _repaired + 1;
    _details := _details || jsonb_build_object('voucher_id', _v.id, 'voucher_number', _v.voucher_number,
                            'status', 'repaired', 'amount_paise', _amount);

    INSERT INTO public.voucher_repair_audit (company_id, voucher_id, action, details, performed_by)
    VALUES (_company_id, _v.id, 'suspense_post',
            jsonb_build_object('amount_paise', _amount, 'suspense_ledger', _suspense_id),
            auth.uid());
  END LOOP;

  RETURN jsonb_build_object('repaired', _repaired, 'skipped', _skipped, 'suspense_ledger_id', _suspense_id, 'details', _details);
END $$;

-- Reclassify Receipt/Payment/Contra vouchers that have no Cash/Bank ledger to Journal
CREATE OR REPLACE FUNCTION public.reclassify_misposted_vouchers(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _v RECORD;
  _n int := 0;
  _details jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_company_role(_company_id, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Only admins can reclassify vouchers';
  END IF;

  FOR _v IN
    SELECT v.id, v.voucher_type, v.voucher_number
      FROM public.vouchers v
     WHERE v.company_id = _company_id
       AND v.voucher_type IN ('receipt','payment','contra')
       AND NOT EXISTS (
         SELECT 1 FROM public.voucher_entries ve
           JOIN public.ledgers l ON l.id = ve.ledger_id
          WHERE ve.voucher_id = v.id
            AND l.type IN ('cash','bank')
       )
  LOOP
    UPDATE public.vouchers SET voucher_type = 'journal', updated_at = now() WHERE id = _v.id;
    _n := _n + 1;
    _details := _details || jsonb_build_object('voucher_id', _v.id, 'voucher_number', _v.voucher_number, 'from', _v.voucher_type, 'to', 'journal');
    INSERT INTO public.voucher_repair_audit (company_id, voucher_id, action, details, performed_by)
    VALUES (_company_id, _v.id, 'reclassify_to_journal',
            jsonb_build_object('from', _v.voucher_type), auth.uid());
  END LOOP;

  RETURN jsonb_build_object('reclassified', _n, 'details', _details);
END $$;
