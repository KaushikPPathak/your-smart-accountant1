-- Restore missing triggers. The functions exist but no triggers fire them,
-- so new auth users don't get a profile row, new companies don't get a
-- company_members admin row or company_settings row, and period locks are
-- not enforced. This re-attaches every trigger idempotently.

-- 1) auth.users -> profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) public.companies -> company_members(admin) for the creator
DROP TRIGGER IF EXISTS on_company_created_add_admin ON public.companies;
CREATE TRIGGER on_company_created_add_admin
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_company();

-- 3) public.companies -> company_settings row
DROP TRIGGER IF EXISTS on_company_created_settings ON public.companies;
CREATE TRIGGER on_company_created_settings
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_company_settings();

-- 4) updated_at maintenance on every table that has the column
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I.%I',
      r.table_schema, r.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      r.table_schema, r.table_name
    );
  END LOOP;
END $$;

-- 5) Period-lock enforcement on vouchers
DROP TRIGGER IF EXISTS enforce_period_lock_vouchers ON public.vouchers;
CREATE TRIGGER enforce_period_lock_vouchers
  BEFORE INSERT OR UPDATE OR DELETE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_vouchers();

-- 6) Period-lock enforcement on voucher children
DROP TRIGGER IF EXISTS enforce_period_lock_entries ON public.voucher_entries;
CREATE TRIGGER enforce_period_lock_entries
  BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_child();

DROP TRIGGER IF EXISTS enforce_period_lock_items ON public.voucher_items;
CREATE TRIGGER enforce_period_lock_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_child();

-- Backfill: any auth.users without a profile row gets one now.
INSERT INTO public.profiles (user_id, full_name, email)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', ''), u.email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
 WHERE p.user_id IS NULL;

-- Backfill: any company without a company_settings row gets one now.
INSERT INTO public.company_settings (company_id)
SELECT c.id FROM public.companies c
  LEFT JOIN public.company_settings s ON s.company_id = c.id
 WHERE s.company_id IS NULL;

-- Backfill: any company whose creator isn't in company_members gets added as admin.
INSERT INTO public.company_members (company_id, user_id, role)
SELECT c.id, c.created_by, 'admin'::company_role
  FROM public.companies c
  LEFT JOIN public.company_members m
    ON m.company_id = c.id AND m.user_id = c.created_by
 WHERE c.created_by IS NOT NULL AND m.user_id IS NULL;
