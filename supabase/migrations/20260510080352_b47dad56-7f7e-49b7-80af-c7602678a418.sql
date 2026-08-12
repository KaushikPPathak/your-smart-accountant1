CREATE OR REPLACE FUNCTION public.next_voucher_number(_company_id uuid, _type voucher_type)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _prefix text;
  _num bigint;
  _max_existing bigint;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(MAX((regexp_match(voucher_number, '([0-9]+)$'))[1]::bigint), 0)
    INTO _max_existing
  FROM public.vouchers
  WHERE company_id = _company_id
    AND voucher_type = _type
    AND voucher_number ~ '[0-9]+$';

  INSERT INTO public.voucher_number_seq (company_id, voucher_type, prefix, next_number)
  VALUES (_company_id, _type, '', _max_existing + 1)
  ON CONFLICT (company_id, voucher_type) DO UPDATE
    SET next_number = GREATEST(public.voucher_number_seq.next_number, _max_existing + 1);

  PERFORM 1
    FROM public.voucher_number_seq
   WHERE company_id = _company_id AND voucher_type = _type
   FOR UPDATE;

  UPDATE public.voucher_number_seq
     SET next_number = next_number + 1
   WHERE company_id = _company_id AND voucher_type = _type
  RETURNING prefix, next_number - 1 INTO _prefix, _num;

  RETURN COALESCE(_prefix, '') || _num::text;
END;
$function$;

WITH existing AS (
  SELECT
    company_id,
    voucher_type,
    COALESCE(MAX((regexp_match(voucher_number, '([0-9]+)$'))[1]::bigint), 0) + 1 AS repaired_next_number
  FROM public.vouchers
  WHERE voucher_number ~ '[0-9]+$'
  GROUP BY company_id, voucher_type
)
INSERT INTO public.voucher_number_seq (company_id, voucher_type, prefix, next_number)
SELECT company_id, voucher_type, '', repaired_next_number
FROM existing
ON CONFLICT (company_id, voucher_type) DO UPDATE
  SET next_number = GREATEST(public.voucher_number_seq.next_number, EXCLUDED.next_number);