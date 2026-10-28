-- Review 2026-10-27: close anonymous account-creation path and make voucher
-- deletion atomic.

-- 1. signup_account / setup_first_account always create ADMIN accounts.
--    They must not be callable by anonymous (unauthenticated) clients.
REVOKE EXECUTE ON FUNCTION public.signup_account(text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.signup_account(text, text, text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.setup_first_account(text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.setup_first_account(text, text, text, boolean) TO authenticated;

-- 2. Delete a voucher in ONE transaction: children first, then soft-delete the
--    header. SECURITY INVOKER keeps existing RLS and period-lock triggers in force.
CREATE OR REPLACE FUNCTION public.delete_voucher_atomic(_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vouchers WHERE id = _voucher_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Voucher not found or already deleted';
  END IF;
  DELETE FROM public.voucher_entries WHERE voucher_id = _voucher_id;
  DELETE FROM public.voucher_items   WHERE voucher_id = _voucher_id;
  UPDATE public.vouchers SET deleted_at = now() WHERE id = _voucher_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_voucher_atomic(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_voucher_atomic(uuid) TO authenticated;
