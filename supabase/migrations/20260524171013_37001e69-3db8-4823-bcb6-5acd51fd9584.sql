
-- 1) Extend app_users
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE public.app_users ALTER COLUMN pin_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_uk
  ON public.app_users (lower(username)) WHERE username IS NOT NULL;

-- 2) Per-account ownership on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_app_user_id UUID;
CREATE INDEX IF NOT EXISTS companies_owner_app_user_id_idx
  ON public.companies(owner_app_user_id);

-- 3) First-run setup: create admin and adopt existing unowned companies
CREATE OR REPLACE FUNCTION public.setup_first_account(_name TEXT, _username TEXT, _password TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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

  -- Wipe any prior PIN-only seed rows so the first username/password setup is clean
  DELETE FROM public.app_users WHERE password_hash IS NULL;

  INSERT INTO public.app_users(name, role, username, password_hash)
  VALUES (trim(_name), 'admin', lower(_username), crypt(_password, gen_salt('bf', 10)))
  RETURNING id INTO _id;

  -- Link every existing company without an owner to this first admin
  UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;

  RETURN _id;
END $$;

-- 4) Signup for additional accounts (new computer / new user)
CREATE OR REPLACE FUNCTION public.signup_account(_name TEXT, _username TEXT, _password TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id UUID; _is_first BOOLEAN;
BEGIN
  SELECT (count(*) = 0) INTO _is_first
    FROM public.app_users WHERE password_hash IS NOT NULL;

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
  VALUES (
    trim(_name),
    CASE WHEN _is_first THEN 'admin'::app_user_role ELSE 'admin'::app_user_role END,
    lower(_username),
    crypt(_password, gen_salt('bf', 10))
  )
  RETURNING id INTO _id;

  IF _is_first THEN
    -- Migrate existing unowned companies to the very first account only
    UPDATE public.companies SET owner_app_user_id = _id WHERE owner_app_user_id IS NULL;
  END IF;

  RETURN _id;
END $$;

-- 5) Verify a login attempt
CREATE OR REPLACE FUNCTION public.verify_account_login(_username TEXT, _password TEXT)
RETURNS TABLE(id UUID, name TEXT, role app_user_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.app_users%ROWTYPE;
BEGIN
  SELECT * INTO _row
    FROM public.app_users
   WHERE lower(username) = lower(_username) AND is_active = TRUE;
  IF NOT FOUND OR _row.password_hash IS NULL THEN
    RETURN;
  END IF;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked. Try again in a moment.';
  END IF;

  IF _row.password_hash = crypt(_password, _row.password_hash) THEN
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
END $$;

-- 6) Change password (self-serve, requires current password)
CREATE OR REPLACE FUNCTION public.change_account_password(_user_id UUID, _current TEXT, _new TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _hash TEXT;
BEGIN
  SELECT password_hash INTO _hash FROM public.app_users WHERE id = _user_id;
  IF _hash IS NULL OR _hash <> crypt(COALESCE(_current,''), _hash) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;
  IF _new IS NULL OR length(_new) < 6 THEN
    RAISE EXCEPTION 'New password must be at least 6 characters';
  END IF;
  UPDATE public.app_users
     SET password_hash = crypt(_new, gen_salt('bf', 10))
   WHERE id = _user_id;
END $$;

-- 7) Helper to count accounts (for "first run" UX)
CREATE OR REPLACE FUNCTION public.accounts_exist()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE password_hash IS NOT NULL)
$$;
