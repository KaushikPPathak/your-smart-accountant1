DROP POLICY IF EXISTS "Authenticated can read app_users" ON public.app_users;

REVOKE SELECT ON public.app_users FROM authenticated;
REVOKE SELECT ON public.app_users FROM anon;
GRANT ALL ON public.app_users TO service_role;