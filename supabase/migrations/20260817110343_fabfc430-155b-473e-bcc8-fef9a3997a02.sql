-- verify_company_password(_company_id uuid, _attempt text)
REVOKE EXECUTE ON FUNCTION public.verify_company_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_company_password(uuid, text) TO authenticated;

-- verify_account_login(_username text, _password text)
-- Note: parameters 3, 4, 5 are OUT parameters (id, name, role)
REVOKE EXECUTE ON FUNCTION public.verify_account_login(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_account_login(text, text) TO authenticated;

-- change_account_password(_user_id uuid, _old_password text, _new_password text)
REVOKE EXECUTE ON FUNCTION public.change_account_password(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.change_account_password(uuid, text, text) TO authenticated;

-- set_company_password(_company_id uuid, _new_password text)
REVOKE EXECUTE ON FUNCTION public.set_company_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_company_password(uuid, text) TO authenticated;

-- recompute_monthly_balances(_company_id uuid, from_date date, to_date date)
-- Note: parameters 2 and 3 were date, but ORDINAL position showed only _company_id in my previous read?
-- Actually, ordinal position 1 is _company_id. If no others are listed, it might use defaults or be a different signature.
-- Let's try to revoke execute on all functions with these names to be safe.

DO $$
DECLARE
    func_name text;
    func_schema text := 'public';
    func_oid oid;
BEGIN
    FOR func_name IN SELECT unnest(ARRAY[
        'verify_company_password', 
        'verify_account_login', 
        'change_account_password', 
        'set_company_password', 
        'recompute_monthly_balances', 
        'next_voucher_number', 
        'save_voucher_atomic', 
        'accounts_exist'
    ]) LOOP
        FOR func_oid IN 
            SELECT oid FROM pg_proc 
            WHERE proname = func_name 
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = func_schema)
        LOOP
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s.%I(%s) FROM public', 
                func_schema, func_name, pg_get_function_identity_arguments(func_oid));
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s.%I(%s) TO authenticated', 
                func_schema, func_name, pg_get_function_identity_arguments(func_oid));
        END LOOP;
    END LOOP;
END $$;
