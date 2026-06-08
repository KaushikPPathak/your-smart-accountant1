
-- 1. Hide flag
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS hide_from_picker boolean NOT NULL DEFAULT false;

-- 2. Public-ish list for the login dropdown.
-- Returns only non-sensitive identity columns; respects the hide flag.
CREATE OR REPLACE FUNCTION public.list_login_users()
RETURNS TABLE(id uuid, name text, username text, role public.app_user_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id, au.name, au.username, au.role
    FROM public.app_users au
   WHERE au.is_active = TRUE
     AND au.password_hash IS NOT NULL
     AND au.hide_from_picker = FALSE
   ORDER BY au.name ASC
$$;

GRANT EXECUTE ON FUNCTION public.list_login_users() TO anon, authenticated;

-- 3. Signup with optional hide flag
CREATE OR REPLACE FUNCTION public.signup_account(
  _name text, _username text, _password text, _hide_from_picker boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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
  IF _is_first THEN DELETE FROM public.app_users WHERE password_hash IS NULL; END IF;

  INSERT INTO public.app_users(name, role, username, password_hash, hide_from_picker)
  VALUES (trim(_name), 'admin'::app_user_role, lower(_username),
          extensions.crypt(_password, extensions.gen_salt('bf', 10)),
          COALESCE(_hide_from_picker, false))
  RETURNING id INTO _id;

  IF _is_first THEN
    UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.setup_first_account(
  _name text, _username text, _password text, _hide_from_picker boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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

  INSERT INTO public.app_users(name, role, username, password_hash, hide_from_picker)
  VALUES (trim(_name), 'admin', lower(_username),
          extensions.crypt(_password, extensions.gen_salt('bf', 10)),
          COALESCE(_hide_from_picker, false))
  RETURNING id INTO _id;
  UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;
  RETURN _id;
END $$;

-- 4. Admin re-auth helper for password-based accounts
CREATE OR REPLACE FUNCTION public._require_admin_password(_admin_id uuid, _admin_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _hash text; _role public.app_user_role; _active boolean;
BEGIN
  SELECT password_hash, role, is_active INTO _hash, _role, _active
    FROM public.app_users WHERE id = _admin_id;
  IF _hash IS NULL OR _active IS NOT TRUE OR _role <> 'admin' THEN
    RAISE EXCEPTION 'Admin authorization failed';
  END IF;
  IF _hash <> extensions.crypt(_admin_password, _hash) THEN
    RAISE EXCEPTION 'Admin password incorrect';
  END IF;
END $$;

-- 5. List ALL accounts (admin only) for management UI
CREATE OR REPLACE FUNCTION public.list_accounts_admin(_admin_id uuid, _admin_password text)
RETURNS TABLE(id uuid, name text, username text, role public.app_user_role,
              is_active boolean, hide_from_picker boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin_password(_admin_id, _admin_password);
  RETURN QUERY
    SELECT au.id, au.name, au.username, au.role, au.is_active, au.hide_from_picker, au.created_at
      FROM public.app_users au
     WHERE au.password_hash IS NOT NULL
     ORDER BY au.created_at ASC;
END $$;

-- 6. Update an account
CREATE OR REPLACE FUNCTION public.update_account_admin(
  _admin_id uuid, _admin_password text, _target_id uuid,
  _new_name text, _new_role public.app_user_role,
  _is_active boolean, _hide_from_picker boolean,
  _new_password text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _admin_count int;
BEGIN
  PERFORM public._require_admin_password(_admin_id, _admin_password);
  IF _new_name IS NULL OR length(trim(_new_name)) = 0 THEN RAISE EXCEPTION 'Name is required'; END IF;

  -- Don't allow removing the last active admin
  IF (_new_role <> 'admin' OR _is_active = false) THEN
    SELECT count(*) INTO _admin_count FROM public.app_users
      WHERE role = 'admin' AND is_active = true AND password_hash IS NOT NULL AND id <> _target_id;
    IF _admin_count = 0 THEN
      RAISE EXCEPTION 'At least one active admin must remain';
    END IF;
  END IF;

  UPDATE public.app_users
     SET name = trim(_new_name),
         role = _new_role,
         is_active = _is_active,
         hide_from_picker = COALESCE(_hide_from_picker, false),
         password_hash = CASE
           WHEN _new_password IS NOT NULL AND length(_new_password) >= 6
             THEN extensions.crypt(_new_password, extensions.gen_salt('bf', 10))
           ELSE password_hash END,
         updated_at = now()
   WHERE id = _target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
END $$;

-- 7. Delete an account
CREATE OR REPLACE FUNCTION public.delete_account_admin(
  _admin_id uuid, _admin_password text, _target_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _admin_count int; _target_role public.app_user_role;
BEGIN
  PERFORM public._require_admin_password(_admin_id, _admin_password);
  IF _admin_id = _target_id THEN RAISE EXCEPTION 'You cannot delete your own account'; END IF;
  SELECT role INTO _target_role FROM public.app_users WHERE id = _target_id;
  IF _target_role IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;
  IF _target_role = 'admin' THEN
    SELECT count(*) INTO _admin_count FROM public.app_users
      WHERE role = 'admin' AND is_active = true AND password_hash IS NOT NULL AND id <> _target_id;
    IF _admin_count = 0 THEN RAISE EXCEPTION 'At least one active admin must remain'; END IF;
  END IF;
  DELETE FROM public.app_users WHERE id = _target_id;
END $$;

GRANT EXECUTE ON FUNCTION public.list_accounts_admin(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_account_admin(uuid, text, uuid, text, public.app_user_role, boolean, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_admin(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_account(text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_first_account(text, text, text, boolean) TO anon, authenticated;
