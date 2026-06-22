
CREATE TABLE public.voucher_export_details (
  voucher_id uuid PRIMARY KEY REFERENCES public.vouchers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Header
  export_type text NOT NULL DEFAULT 'lut_wop' CHECK (export_type IN ('lut_wop','with_igst','sez_wp','sez_wop','deemed')),
  iec_no text,
  lut_no text,
  lut_date date,
  -- Consignee / buyer
  consignee_name text,
  consignee_address text,
  consignee_country text,
  buyer_name text,
  buyer_address text,
  buyer_country text,
  -- Shipment
  pre_carriage_by text,
  place_of_receipt text,
  vessel_flight_no text,
  port_of_loading text,
  port_of_discharge text,
  final_destination text,
  country_of_origin text DEFAULT 'India',
  country_of_destination text,
  container_no text,
  marks_nos text,
  no_of_packages text,
  kind_of_packages text,
  net_weight_kg numeric(14,3),
  gross_weight_kg numeric(14,3),
  incoterms text,
  payment_terms text,
  -- Currency / FX
  currency_code text NOT NULL DEFAULT 'USD',
  fx_rate numeric(14,6) NOT NULL DEFAULT 1,
  fx_rate_source text,
  -- Agri-specific
  crop_year text,
  lot_batch_no text,
  fssai_no text,
  apeda_rcmc_no text,
  phyto_cert_no text,
  variety_grade text,
  moisture_pct numeric(5,2),
  packing_spec text,
  -- Tax / declaration
  igst_refund_claim boolean NOT NULL DEFAULT false,
  declaration text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_export_details TO authenticated;
GRANT ALL ON public.voucher_export_details TO service_role;

ALTER TABLE public.voucher_export_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read export details"
  ON public.voucher_export_details FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = voucher_export_details.company_id AND m.user_id = auth.uid()));

CREATE POLICY "Members write export details"
  ON public.voucher_export_details FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = voucher_export_details.company_id AND m.user_id = auth.uid()));

CREATE POLICY "Members update export details"
  ON public.voucher_export_details FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = voucher_export_details.company_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = voucher_export_details.company_id AND m.user_id = auth.uid()));

CREATE POLICY "Members delete export details"
  ON public.voucher_export_details FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = voucher_export_details.company_id AND m.user_id = auth.uid()));

CREATE TRIGGER update_voucher_export_details_updated_at
  BEFORE UPDATE ON public.voucher_export_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
