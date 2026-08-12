-- Restrict the new PIN-system RPCs to authenticated callers only.
REVOKE EXECUTE ON FUNCTION public.app_users_count()                        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.setup_first_admin(TEXT, TEXT)            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.verify_app_user_pin(UUID, TEXT)          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_app_user(UUID, TEXT, TEXT, public.app_user_role, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reset_app_user_pin(UUID, TEXT, UUID, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_app_user(UUID, TEXT, UUID)        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._require_admin(UUID, TEXT)               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._validate_pin(TEXT)                      FROM anon, public;

GRANT EXECUTE ON FUNCTION public.app_users_count()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_first_admin(TEXT, TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_app_user_pin(UUID, TEXT)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_app_user(UUID, TEXT, TEXT, public.app_user_role, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_app_user_pin(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_app_user(UUID, TEXT, UUID)         TO authenticated;

-- Pin search_path on the validator helper.
ALTER FUNCTION public._validate_pin(TEXT) SET search_path = public;