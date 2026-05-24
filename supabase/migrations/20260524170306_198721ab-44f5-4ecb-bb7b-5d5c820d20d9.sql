-- Lock-screen staff/PIN system. Layered on top of the shared "tech user"
-- Supabase session (Phase A1) — these PINs gate the local workstation, RLS
-- still runs as the tech user underneath.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.app_user_role AS ENUM ('admin', 'staff');

CREATE TABLE public.app_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  role            public.app_user_role NOT NULL DEFAULT 'staff',
  pin_hash        TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_unlock_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- The whole app shares one Supabase auth user. Any signed-in session can
-- read the staff list (needed to render the lock screen). All writes go
-- through SECURITY DEFINER RPCs that re-verify an admin PIN.
CREATE POLICY "Authenticated can read app_users"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (true);

-- No direct INSERT/UPDATE/DELETE policies on purpose. Writes happen only
-- via the RPCs below.

-- Validate a PIN: 4–6 digits.
CREATE OR REPLACE FUNCTION public._validate_pin(_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _pin IS NULL OR _pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 6 digits';
  END IF;
END;
$$;

-- Re-check an admin's PIN; raises if not an active admin or PIN is wrong.
CREATE OR REPLACE FUNCTION public._require_admin(_admin_id UUID, _admin_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash TEXT;
  _role public.app_user_role;
  _active BOOLEAN;
BEGIN
  SELECT pin_hash, role, is_active INTO _hash, _role, _active
    FROM public.app_users WHERE id = _admin_id;
  IF _hash IS NULL OR _active IS NOT TRUE OR _role <> 'admin' THEN
    RAISE EXCEPTION 'Admin authorization failed';
  END IF;
  IF _hash <> crypt(_admin_pin, _hash) THEN
    RAISE EXCEPTION 'Admin PIN incorrect';
  END IF;
END;
$$;

-- How many app_users exist? Used by clients to show first-run setup.
CREATE OR REPLACE FUNCTION public.app_users_count()
RETURNS INT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT count(*)::int FROM public.app_users $$;

-- First-run: create the very first admin. Only works when table is empty.
CREATE OR REPLACE FUNCTION public.setup_first_admin(_name TEXT, _pin TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  IF (SELECT count(*) FROM public.app_users) > 0 THEN
    RAISE EXCEPTION 'Setup already complete';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  PERFORM public._validate_pin(_pin);

  INSERT INTO public.app_users (name, role, pin_hash)
  VALUES (trim(_name), 'admin', crypt(_pin, gen_salt('bf', 10)))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Verify a PIN. Updates lockout / last_unlock_at. Returns true/false.
CREATE OR REPLACE FUNCTION public.verify_app_user_pin(_user_id UUID, _pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash TEXT;
  _active BOOLEAN;
  _locked TIMESTAMPTZ;
BEGIN
  SELECT pin_hash, is_active, locked_until INTO _hash, _active, _locked
    FROM public.app_users WHERE id = _user_id;
  IF _hash IS NULL OR _active IS NOT TRUE THEN
    RETURN FALSE;
  END IF;
  IF _locked IS NOT NULL AND _locked > now() THEN
    RAISE EXCEPTION 'Account temporarily locked. Try again in a moment.';
  END IF;

  IF _hash = crypt(COALESCE(_pin,''), _hash) THEN
    UPDATE public.app_users
       SET failed_attempts = 0,
           locked_until = NULL,
           last_unlock_at = now()
     WHERE id = _user_id;
    RETURN TRUE;
  ELSE
    UPDATE public.app_users
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= 5 THEN now() + interval '60 seconds'
             ELSE locked_until
           END
     WHERE id = _user_id;
    RETURN FALSE;
  END IF;
END;
$$;

-- Admin: create a new staff member.
CREATE OR REPLACE FUNCTION public.create_app_user(
  _admin_id UUID, _admin_pin TEXT,
  _name TEXT, _role public.app_user_role, _pin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  PERFORM public._require_admin(_admin_id, _admin_pin);
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  PERFORM public._validate_pin(_pin);

  INSERT INTO public.app_users (name, role, pin_hash)
  VALUES (trim(_name), _role, crypt(_pin, gen_salt('bf', 10)))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Admin: reset a staff member's PIN.
CREATE OR REPLACE FUNCTION public.reset_app_user_pin(
  _admin_id UUID, _admin_pin TEXT,
  _target_id UUID, _new_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin(_admin_id, _admin_pin);
  PERFORM public._validate_pin(_new_pin);

  UPDATE public.app_users
     SET pin_hash = crypt(_new_pin, gen_salt('bf', 10)),
         failed_attempts = 0,
         locked_until = NULL
   WHERE id = _target_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Staff not found'; END IF;
END;
$$;

-- Admin: delete a staff member. Blocks removing the last admin.
CREATE OR REPLACE FUNCTION public.delete_app_user(
  _admin_id UUID, _admin_pin TEXT, _target_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_role public.app_user_role;
  _admin_count INT;
BEGIN
  PERFORM public._require_admin(_admin_id, _admin_pin);
  SELECT role INTO _target_role FROM public.app_users WHERE id = _target_id;
  IF _target_role IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;
  IF _target_role = 'admin' THEN
    SELECT count(*) INTO _admin_count FROM public.app_users
      WHERE role = 'admin' AND is_active = true;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;
  DELETE FROM public.app_users WHERE id = _target_id;
END;
$$;