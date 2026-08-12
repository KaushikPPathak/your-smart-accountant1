DO $$
DECLARE
  r RECORD;
  drop_sql TEXT;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.table_name <> 'companies'
  LOOP
    SELECT COALESCE(string_agg(format('ALTER TABLE public.%I DROP CONSTRAINT %I;', r.table_name, con.conname), ' '), '')
      INTO drop_sql
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relname = r.table_name
      AND con.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(con.conkey) ck
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ck
        WHERE a.attname = 'company_id'
      );
    IF drop_sql <> '' THEN EXECUTE drop_sql; END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;',
      r.table_name,
      r.table_name || '_company_id_fkey'
    );
  END LOOP;

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'voucher_id'
      AND c.table_name <> 'vouchers'
  LOOP
    SELECT COALESCE(string_agg(format('ALTER TABLE public.%I DROP CONSTRAINT %I;', r.table_name, con.conname), ' '), '')
      INTO drop_sql
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relname = r.table_name
      AND con.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(con.conkey) ck
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ck
        WHERE a.attname = 'voucher_id'
      );
    IF drop_sql <> '' THEN EXECUTE drop_sql; END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id) ON DELETE CASCADE;',
      r.table_name,
      r.table_name || '_voucher_id_fkey'
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_company_type_number_uniq
  ON public.vouchers (company_id, voucher_type, voucher_number);

CREATE OR REPLACE FUNCTION public.next_voucher_number(_company_id uuid, _type voucher_type)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _prefix TEXT;
  _num BIGINT;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.voucher_number_seq (company_id, voucher_type, prefix, next_number)
  VALUES (_company_id, _type, '', 1)
  ON CONFLICT (company_id, voucher_type) DO NOTHING;

  PERFORM 1
    FROM public.voucher_number_seq
   WHERE company_id = _company_id AND voucher_type = _type
   FOR UPDATE;

  UPDATE public.voucher_number_seq
     SET next_number = next_number + 1
   WHERE company_id = _company_id AND voucher_type = _type
  RETURNING prefix, next_number - 1 INTO _prefix, _num;

  RETURN COALESCE(_prefix, '') || _num::TEXT;
END;
$function$;