DROP POLICY IF EXISTS "allow_authenticated_all" ON public.inventory_manual_valuations;

CREATE POLICY "imv_select_members" ON public.inventory_manual_valuations
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "imv_insert_writers" ON public.inventory_manual_valuations
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));

CREATE POLICY "imv_update_writers" ON public.inventory_manual_valuations
  FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));

CREATE POLICY "imv_delete_writers" ON public.inventory_manual_valuations
  FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_manual_valuations TO authenticated;
GRANT ALL ON public.inventory_manual_valuations TO service_role;