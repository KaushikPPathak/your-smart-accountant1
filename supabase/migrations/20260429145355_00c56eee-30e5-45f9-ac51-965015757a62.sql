-- Repair migration: re-create all triggers that were lost on remix.
-- The functions exist (handle_new_user, handle_new_company, handle_new_company_settings,
-- update_updated_at_column) but no triggers were wired to fire them on this fresh
-- Cloud backend. Result: signups didn't create profiles, new companies didn't get
-- admin members or settings rows, and updated_at columns never updated.
-- Each trigger uses DROP IF EXISTS so this migration is safe to re-run.

-- 1. Auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Auto-create company admin membership on new company
DROP TRIGGER IF EXISTS on_company_created ON public.companies;
CREATE TRIGGER on_company_created
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_company();

-- 3. Auto-seed company_settings row on new company
DROP TRIGGER IF EXISTS trg_company_settings_seed ON public.companies;
CREATE TRIGGER trg_company_settings_seed
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_company_settings();

-- 4. updated_at maintenance triggers
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS ledgers_updated_at ON public.ledgers;
CREATE TRIGGER ledgers_updated_at BEFORE UPDATE ON public.ledgers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS items_updated_at ON public.items;
CREATE TRIGGER items_updated_at BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS vouchers_updated_at ON public.vouchers;
CREATE TRIGGER vouchers_updated_at BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_settings_updated_at ON public.company_settings;
CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS recurring_invoices_updated_at ON public.recurring_invoices;
CREATE TRIGGER recurring_invoices_updated_at BEFORE UPDATE ON public.recurring_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS einvoice_updated_at ON public.einvoice_details;
CREATE TRIGGER einvoice_updated_at BEFORE UPDATE ON public.einvoice_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_gac_updated_at ON public.gst_api_credentials;
CREATE TRIGGER trg_gac_updated_at
  BEFORE UPDATE ON public.gst_api_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();