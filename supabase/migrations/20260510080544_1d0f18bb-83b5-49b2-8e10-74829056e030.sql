REVOKE ALL ON FUNCTION public.next_voucher_number(uuid, public.voucher_type) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_voucher_number(uuid, public.voucher_type) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_voucher_number(uuid, public.voucher_type) TO authenticated;