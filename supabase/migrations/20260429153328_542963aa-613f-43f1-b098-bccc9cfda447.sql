
-- 1) Enable pgcrypto for bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Add password columns to companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS access_password_hash text,
  ADD COLUMN IF NOT EXISTS access_password_set_at timestamptz;

-- 3) RPC: set / change / clear company password (admin only)
CREATE OR REPLACE FUNCTION public.set_company_password(_company_id uuid, _new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_company_role(_company_id, auth.uid(), 'admin'::company_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _new_password IS NULL OR length(_new_password) = 0 THEN
    UPDATE public.companies
       SET access_password_hash = NULL,
           access_password_set_at = NULL
     WHERE id = _company_id;
  ELSE
    IF length(_new_password) < 4 THEN
      RAISE EXCEPTION 'Password must be at least 4 characters';
    END IF;
    UPDATE public.companies
       SET access_password_hash = crypt(_new_password, gen_salt('bf', 10)),
           access_password_set_at = now()
     WHERE id = _company_id;
  END IF;
END;
$$;

-- 4) RPC: verify company password (any authenticated member)
CREATE OR REPLACE FUNCTION public.verify_company_password(_company_id uuid, _attempt text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this company';
  END IF;

  SELECT access_password_hash INTO _hash
    FROM public.companies WHERE id = _company_id;

  -- No password set → unlocked
  IF _hash IS NULL THEN RETURN true; END IF;
  IF _attempt IS NULL THEN RETURN false; END IF;

  RETURN _hash = crypt(_attempt, _hash);
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_password(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.verify_company_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_company_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_company_password(uuid, text) TO authenticated;

-- 5) Lightweight view for the start screen (only id / name / has_password)
CREATE OR REPLACE VIEW public.companies_picker
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.name,
  (c.access_password_hash IS NOT NULL) AS has_password
FROM public.companies c
WHERE public.is_company_member(c.id, auth.uid()) OR c.created_by = auth.uid();

GRANT SELECT ON public.companies_picker TO authenticated;

-- 6) Merge mehtaji@live.com -> acauntant@gmail.com
DO $$
DECLARE
  old_uid uuid := 'f6c0d7f2-d1f9-420b-b339-1ae580b8217d'; -- mehtaji@live.com
  new_uid uuid := 'b1b19b8a-3d1a-4360-b3b6-2cf696031767'; -- acauntant@gmail.com
BEGIN
  -- Reassign ownership of all data
  UPDATE public.companies         SET created_by = new_uid WHERE created_by = old_uid;
  UPDATE public.vouchers          SET created_by = new_uid WHERE created_by = old_uid;
  UPDATE public.recurring_invoices SET created_by = new_uid WHERE created_by = old_uid;
  UPDATE public.bank_statements   SET imported_by = new_uid WHERE imported_by = old_uid;
  UPDATE public.gstr2b_imports    SET imported_by = new_uid WHERE imported_by = old_uid;
  UPDATE public.payment_reminders SET sent_by    = new_uid WHERE sent_by   = old_uid;
  UPDATE public.einvoice_api_log  SET created_by = new_uid WHERE created_by = old_uid;

  -- Re-point company memberships, dropping any duplicate (same company already a member of new_uid)
  DELETE FROM public.company_members
   WHERE user_id = old_uid
     AND company_id IN (SELECT company_id FROM public.company_members WHERE user_id = new_uid);
  UPDATE public.company_members SET user_id = new_uid WHERE user_id = old_uid;

  -- Remove old profile + auth user (cascade cleans the rest)
  DELETE FROM public.profiles WHERE user_id = old_uid;
  DELETE FROM auth.users WHERE id = old_uid;
END $$;
