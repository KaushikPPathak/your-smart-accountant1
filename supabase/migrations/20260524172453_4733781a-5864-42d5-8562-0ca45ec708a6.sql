CREATE OR REPLACE FUNCTION public.setup_first_account(_name text, _username text, _password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _id UUID;
BEGIN
  IF (SELECT count(*) FROM public.app_users WHERE password_hash IS NOT NULL) > 0 THEN
    RAISE EXCEPTION 'An account already exists. Please log in.';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF _username IS NULL OR _username !~ '^[a-zA-Z0-9_.-]{3,40}$' THEN
    RAISE EXCEPTION 'Username must be 3-40 chars (letters, digits, dot, underscore, dash)';
  END IF;
  IF _password IS NULL OR length(_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  DELETE FROM public.app_users WHERE password_hash IS NULL;

  INSERT INTO public.app_users(name, role, username, password_hash)
  VALUES (trim(_name), 'admin', lower(_username), extensions.crypt(_password, extensions.gen_salt('bf', 10)))
  RETURNING id INTO _id;

  UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;

  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.signup_account(_name text, _username text, _password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _id UUID; _is_first BOOLEAN;
BEGIN
  SELECT (count(*) = 0) INTO _is_first FROM public.app_users WHERE password_hash IS NOT NULL;

  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF _username IS NULL OR _username !~ '^[a-zA-Z0-9_.-]{3,40}$' THEN
    RAISE EXCEPTION 'Username must be 3-40 chars (letters, digits, dot, underscore, dash)';
  END IF;
  IF _password IS NULL OR length(_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE lower(username) = lower(_username)) THEN
    RAISE EXCEPTION 'That username is already taken';
  END IF;

  IF _is_first THEN
    DELETE FROM public.app_users WHERE password_hash IS NULL;
  END IF;

  INSERT INTO public.app_users(name, role, username, password_hash)
  VALUES (trim(_name), 'admin'::app_user_role, lower(_username),
          extensions.crypt(_password, extensions.gen_salt('bf', 10)))
  RETURNING id INTO _id;

  IF _is_first THEN
    UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;
  END IF;

  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.verify_account_login(_username text, _password text)
 RETURNS TABLE(id uuid, name text, role app_user_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _row public.app_users%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.app_users
   WHERE lower(username) = lower(_username) AND is_active = TRUE;
  IF NOT FOUND OR _row.password_hash IS NULL THEN RETURN; END IF;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked. Try again in a moment.';
  END IF;

  IF _row.password_hash = extensions.crypt(_password, _row.password_hash) THEN
    UPDATE public.app_users
       SET failed_attempts = 0, locked_until = NULL, last_unlock_at = now()
     WHERE id = _row.id;
    RETURN QUERY SELECT _row.id, _row.name, _row.role;
  ELSE
    UPDATE public.app_users
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5
                               THEN now() + interval '60 seconds'
                               ELSE locked_until END
     WHERE id = _row.id;
    RETURN;
  END IF;
END $function$;