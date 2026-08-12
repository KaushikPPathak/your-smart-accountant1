DROP POLICY IF EXISTS companies_select_member ON public.companies;

CREATE POLICY companies_select_member
ON public.companies
FOR SELECT
TO authenticated
USING (
  is_company_member(id, auth.uid())
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS companies_insert_self ON public.companies;

CREATE POLICY companies_insert_self
ON public.companies
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);