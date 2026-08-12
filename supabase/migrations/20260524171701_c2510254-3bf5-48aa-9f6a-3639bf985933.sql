
DROP FUNCTION IF EXISTS public.change_account_password(uuid, text, text);

CREATE OR REPLACE FUNCTION public.change_account_password(_user_id uuid, _old_password text, _new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _row public.app_users%ROWTYPE;
BEGIN
  IF _new_password IS NULL OR length(_new_password) < 6 THEN
    RAISE EXCEPTION 'New password must be at least 6 characters';
  END IF;
  SELECT * INTO _row FROM public.app_users WHERE id = _user_id;
  IF NOT FOUND OR _row.password_hash IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;
  IF _row.password_hash <> extensions.crypt(_old_password, _row.password_hash) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;
  UPDATE public.app_users SET password_hash = extensions.crypt(_new_password, extensions.gen_salt('bf', 10)) WHERE id = _user_id;
END $function$;
