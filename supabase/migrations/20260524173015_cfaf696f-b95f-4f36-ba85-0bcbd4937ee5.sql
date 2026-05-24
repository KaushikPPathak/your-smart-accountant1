CREATE OR REPLACE FUNCTION public.verify_account_login(_username text, _password text)
RETURNS TABLE(id uuid, name text, role app_user_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _row public.app_users%ROWTYPE;
BEGIN
  SELECT au.* INTO _row
    FROM public.app_users AS au
   WHERE lower(au.username) = lower(_username)
     AND au.is_active = TRUE
   LIMIT 1;

  IF NOT FOUND OR _row.password_hash IS NULL THEN
    RETURN;
  END IF;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked. Try again in a moment.';
  END IF;

  IF _row.password_hash = extensions.crypt(_password, _row.password_hash) THEN
    UPDATE public.app_users AS au
       SET failed_attempts = 0,
           locked_until = NULL,
           last_unlock_at = now()
     WHERE au.id = _row.id;

    id := _row.id;
    name := _row.name;
    role := _row.role;
    RETURN NEXT;
  ELSE
    UPDATE public.app_users AS au
       SET failed_attempts = au.failed_attempts + 1,
           locked_until = CASE
             WHEN au.failed_attempts + 1 >= 5 THEN now() + interval '60 seconds'
             ELSE au.locked_until
           END
     WHERE au.id = _row.id;
    RETURN;
  END IF;
END
$function$;