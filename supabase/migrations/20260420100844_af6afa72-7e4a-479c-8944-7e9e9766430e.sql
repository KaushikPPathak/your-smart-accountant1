-- =====================================================
-- ENUMS
-- =====================================================
CREATE TYPE public.company_role AS ENUM ('admin', 'accountant', 'viewer');

CREATE TYPE public.ledger_type AS ENUM (
  'sundry_debtor', 'sundry_creditor', 'cash', 'bank',
  'expense_direct', 'expense_indirect', 'income_direct', 'income_indirect',
  'fixed_asset', 'current_asset', 'current_liability', 'loan_liability',
  'capital', 'duties_taxes', 'stock_in_hand'
);

CREATE TYPE public.voucher_type AS ENUM (
  'sales', 'purchase', 'receipt', 'payment',
  'journal', 'contra', 'credit_note', 'debit_note'
);

-- =====================================================
-- UTILITY: updated_at trigger function
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =====================================================
-- PROFILES
-- =====================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- COMPANIES
-- =====================================================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  gstin TEXT,
  state TEXT,
  state_code TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  financial_year_start DATE NOT NULL DEFAULT (date_trunc('year', now()) + interval '3 months')::date,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- COMPANY MEMBERS (roles per company)
-- =====================================================
CREATE TABLE public.company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.company_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_company_members_user ON public.company_members(user_id);
CREATE INDEX idx_company_members_company ON public.company_members(company_id);

-- Security definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(_company_id UUID, _user_id UUID, _role public.company_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.can_write_company(_company_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id
      AND role IN ('admin', 'accountant')
  )
$$;

-- Companies RLS
CREATE POLICY "companies_select_member" ON public.companies
  FOR SELECT USING (public.is_company_member(id, auth.uid()));
CREATE POLICY "companies_insert_self" ON public.companies
  FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "companies_update_admin" ON public.companies
  FOR UPDATE USING (public.has_company_role(id, auth.uid(), 'admin'));
CREATE POLICY "companies_delete_admin" ON public.companies
  FOR DELETE USING (public.has_company_role(id, auth.uid(), 'admin'));

-- Company members RLS
CREATE POLICY "members_select_in_company" ON public.company_members
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "members_insert_admin_or_self_create" ON public.company_members
  FOR INSERT WITH CHECK (
    public.has_company_role(company_id, auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.created_by = auth.uid())
    )
  );
CREATE POLICY "members_update_admin" ON public.company_members
  FOR UPDATE USING (public.has_company_role(company_id, auth.uid(), 'admin'));
CREATE POLICY "members_delete_admin" ON public.company_members
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

-- Auto-add creator as admin
CREATE OR REPLACE FUNCTION public.handle_new_company()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_company_created
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_company();

-- =====================================================
-- LEDGERS (parties / accounts)
-- =====================================================
CREATE TABLE public.ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.ledger_type NOT NULL,
  gstin TEXT,
  state TEXT,
  state_code TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  opening_balance_paise BIGINT NOT NULL DEFAULT 0,
  opening_balance_is_debit BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE public.ledgers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ledgers_company ON public.ledgers(company_id);
CREATE TRIGGER ledgers_updated_at BEFORE UPDATE ON public.ledgers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "ledgers_select" ON public.ledgers
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "ledgers_insert" ON public.ledgers
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ledgers_update" ON public.ledgers
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "ledgers_delete" ON public.ledgers
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

-- =====================================================
-- ITEMS (stock)
-- =====================================================
CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hsn_code TEXT,
  unit TEXT NOT NULL DEFAULT 'NOS',
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  opening_stock_qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  opening_stock_rate_paise BIGINT NOT NULL DEFAULT 0,
  reorder_level NUMERIC(18,3) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_items_company ON public.items(company_id);
CREATE TRIGGER items_updated_at BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "items_select" ON public.items
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "items_insert" ON public.items
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "items_update" ON public.items
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "items_delete" ON public.items
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

-- =====================================================
-- VOUCHERS
-- =====================================================
CREATE TABLE public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  voucher_type public.voucher_type NOT NULL,
  voucher_number TEXT NOT NULL,
  voucher_date DATE NOT NULL,
  party_ledger_id UUID REFERENCES public.ledgers(id) ON DELETE RESTRICT,
  reference_no TEXT,
  narration TEXT,
  subtotal_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL DEFAULT 0,
  is_interstate BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, voucher_type, voucher_number)
);
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_vouchers_company_date ON public.vouchers(company_id, voucher_date DESC);
CREATE INDEX idx_vouchers_party ON public.vouchers(party_ledger_id);
CREATE TRIGGER vouchers_updated_at BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "vouchers_select" ON public.vouchers
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "vouchers_insert" ON public.vouchers
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()) AND auth.uid() = created_by);
CREATE POLICY "vouchers_update" ON public.vouchers
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "vouchers_delete" ON public.vouchers
  FOR DELETE USING (public.has_company_role(company_id, auth.uid(), 'admin'));

-- =====================================================
-- VOUCHER ITEMS (line items for sales/purchase)
-- =====================================================
CREATE TABLE public.voucher_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  description TEXT,
  qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  rate_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  taxable_paise BIGINT NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  amount_paise BIGINT NOT NULL DEFAULT 0,
  line_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.voucher_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_voucher_items_voucher ON public.voucher_items(voucher_id);

CREATE OR REPLACE FUNCTION public.voucher_company_id(_voucher_id UUID)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.vouchers WHERE id = _voucher_id
$$;

CREATE POLICY "vitems_select" ON public.voucher_items
  FOR SELECT USING (public.is_company_member(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "vitems_insert" ON public.voucher_items
  FOR INSERT WITH CHECK (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "vitems_update" ON public.voucher_items
  FOR UPDATE USING (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "vitems_delete" ON public.voucher_items
  FOR DELETE USING (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));

-- =====================================================
-- VOUCHER ENTRIES (double-entry ledger postings)
-- =====================================================
CREATE TABLE public.voucher_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES public.ledgers(id) ON DELETE RESTRICT,
  debit_paise BIGINT NOT NULL DEFAULT 0,
  credit_paise BIGINT NOT NULL DEFAULT 0,
  narration TEXT,
  line_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit_paise >= 0 AND credit_paise >= 0),
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
);
ALTER TABLE public.voucher_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ventries_voucher ON public.voucher_entries(voucher_id);
CREATE INDEX idx_ventries_ledger ON public.voucher_entries(ledger_id);

CREATE POLICY "ventries_select" ON public.voucher_entries
  FOR SELECT USING (public.is_company_member(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "ventries_insert" ON public.voucher_entries
  FOR INSERT WITH CHECK (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "ventries_update" ON public.voucher_entries
  FOR UPDATE USING (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));
CREATE POLICY "ventries_delete" ON public.voucher_entries
  FOR DELETE USING (public.can_write_company(public.voucher_company_id(voucher_id), auth.uid()));

-- =====================================================
-- VOUCHER NUMBER SEQUENCES (auto-numbering per company per type)
-- =====================================================
CREATE TABLE public.voucher_number_seq (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  voucher_type public.voucher_type NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  next_number BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, voucher_type)
);
ALTER TABLE public.voucher_number_seq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vseq_select" ON public.voucher_number_seq
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "vseq_insert" ON public.voucher_number_seq
  FOR INSERT WITH CHECK (public.can_write_company(company_id, auth.uid()));
CREATE POLICY "vseq_update" ON public.voucher_number_seq
  FOR UPDATE USING (public.can_write_company(company_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.next_voucher_number(_company_id UUID, _type public.voucher_type)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prefix TEXT;
  _num BIGINT;
BEGIN
  IF NOT public.can_write_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.voucher_number_seq (company_id, voucher_type, prefix, next_number)
  VALUES (_company_id, _type, '', 1)
  ON CONFLICT (company_id, voucher_type) DO NOTHING;

  UPDATE public.voucher_number_seq
  SET next_number = next_number + 1
  WHERE company_id = _company_id AND voucher_type = _type
  RETURNING prefix, next_number - 1 INTO _prefix, _num;

  RETURN COALESCE(_prefix, '') || _num::TEXT;
END;
$$;