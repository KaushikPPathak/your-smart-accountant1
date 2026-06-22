// Export Invoice dialog: lets the user fill / edit export-specific details
// for a sales voucher (exporter LUT/IEC, consignee, shipment, agri block,
// FX rate) and then print the dual-currency Export Invoice PDF.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadExportInvoicePdf } from "@/lib/export-invoice-pdf";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  voucherId: string;
  companyId: string;
}

type Row = Record<string, unknown>;

const EMPTY: Row = {
  export_type: "lut_wop",
  currency_code: "USD",
  fx_rate: "1",
  country_of_origin: "India",
  igst_refund_claim: false,
};

export function ExportInvoiceDialog({ open, onOpenChange, voucherId, companyId }: Props) {
  const [row, setRow] = useState<Row>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("voucher_export_details")
        .select("*")
        .eq("voucher_id", voucherId)
        .maybeSingle();
      setRow(data ? { ...EMPTY, ...data } : { ...EMPTY });
    })();
  }, [open, voucherId]);

  const set = (k: string, v: unknown) => setRow((p) => ({ ...p, [k]: v }));

  const save = async (thenPrint: boolean) => {
    setSaving(true);
    try {
      const payload: Row = {
        ...row,
        voucher_id: voucherId,
        company_id: companyId,
        fx_rate: Number(row.fx_rate) || 1,
        net_weight_kg: row.net_weight_kg === "" || row.net_weight_kg == null ? null : Number(row.net_weight_kg),
        gross_weight_kg: row.gross_weight_kg === "" || row.gross_weight_kg == null ? null : Number(row.gross_weight_kg),
        moisture_pct: row.moisture_pct === "" || row.moisture_pct == null ? null : Number(row.moisture_pct),
        lut_date: row.lut_date || null,
      };
      const { error } = await supabase
        .from("voucher_export_details")
        .upsert(payload, { onConflict: "voucher_id" });
      if (error) throw error;
      toast.success("Export details saved");
      if (thenPrint) await downloadExportInvoicePdf(voucherId, companyId);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const f = (k: string, label: string, type: "text" | "number" | "date" = "text") => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={(row[k] as string | number | undefined) ?? ""}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Invoice — details</DialogTitle>
          <DialogDescription>
            Capture exporter, shipment, agri and FX details, then print the Export Invoice (dual currency).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="header">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="header">Header</TabsTrigger>
            <TabsTrigger value="parties">Consignee / Buyer</TabsTrigger>
            <TabsTrigger value="shipment">Shipment</TabsTrigger>
            <TabsTrigger value="agri">Agri Details</TabsTrigger>
            <TabsTrigger value="tax">Tax / Declaration</TabsTrigger>
          </TabsList>

          <TabsContent value="header" className="grid gap-3 md:grid-cols-3 pt-3">
            <div className="grid gap-1 md:col-span-2">
              <Label className="text-xs">Export Type</Label>
              <Select value={String(row.export_type)} onValueChange={(v) => set("export_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lut_wop">Under LUT — without IGST</SelectItem>
                  <SelectItem value="with_igst">Export with payment of IGST</SelectItem>
                  <SelectItem value="sez_wp">SEZ — with IGST</SelectItem>
                  <SelectItem value="sez_wop">SEZ — under LUT</SelectItem>
                  <SelectItem value="deemed">Deemed Export</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {f("iec_no", "IEC No")}
            {f("lut_no", "LUT / Bond No")}
            {f("lut_date", "LUT Date", "date")}
            <div />
            {f("currency_code", "Invoice Currency (e.g. USD, EUR, AED)")}
            {f("fx_rate", "FX Rate — 1 unit = INR", "number")}
            {f("fx_rate_source", "FX Rate Source (e.g. RBI ref 22-Jun-2026)")}
            {f("incoterms", "INCOTERMS (FOB / CIF / CFR …)")}
            {f("payment_terms", "Payment Terms (e.g. 100% TT, LC at sight)")}
          </TabsContent>

          <TabsContent value="parties" className="grid gap-3 md:grid-cols-2 pt-3">
            {f("consignee_name", "Consignee Name")}
            {f("consignee_country", "Consignee Country")}
            <div className="md:col-span-2">
              <Label className="text-xs">Consignee Address</Label>
              <Textarea rows={2} value={(row.consignee_address as string) ?? ""} onChange={(e) => set("consignee_address", e.target.value)} />
            </div>
            {f("buyer_name", "Buyer Name (if different)")}
            {f("buyer_country", "Buyer Country")}
            <div className="md:col-span-2">
              <Label className="text-xs">Buyer Address</Label>
              <Textarea rows={2} value={(row.buyer_address as string) ?? ""} onChange={(e) => set("buyer_address", e.target.value)} />
            </div>
          </TabsContent>

          <TabsContent value="shipment" className="grid gap-3 md:grid-cols-3 pt-3">
            {f("pre_carriage_by", "Pre-Carriage By")}
            {f("place_of_receipt", "Place of Receipt")}
            {f("vessel_flight_no", "Vessel / Flight No")}
            {f("port_of_loading", "Port of Loading")}
            {f("port_of_discharge", "Port of Discharge")}
            {f("final_destination", "Final Destination")}
            {f("country_of_origin", "Country of Origin")}
            {f("country_of_destination", "Country of Destination")}
            {f("container_no", "Container No")}
            {f("marks_nos", "Marks & Nos")}
            {f("no_of_packages", "No. of Packages")}
            {f("kind_of_packages", "Kind of Packages (Bags / Cartons …)")}
            {f("net_weight_kg", "Net Weight (kg)", "number")}
            {f("gross_weight_kg", "Gross Weight (kg)", "number")}
          </TabsContent>

          <TabsContent value="agri" className="grid gap-3 md:grid-cols-3 pt-3">
            {f("variety_grade", "Variety / Grade (e.g. Basmati 1121, G4 Chilli)")}
            {f("crop_year", "Crop Year")}
            {f("lot_batch_no", "Lot / Batch No")}
            {f("moisture_pct", "Moisture %", "number")}
            {f("packing_spec", "Packing Spec (e.g. 25 kg PP bags)")}
            {f("fssai_no", "FSSAI License No")}
            {f("apeda_rcmc_no", "APEDA RCMC No")}
            {f("phyto_cert_no", "Phytosanitary Certificate No")}
          </TabsContent>

          <TabsContent value="tax" className="grid gap-3 pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!row.igst_refund_claim} onCheckedChange={(v) => set("igst_refund_claim", !!v)} />
              IGST refund claimed on this export
            </label>
            <div className="grid gap-1">
              <Label className="text-xs">Declaration (leave blank to use the standard text for the selected export type)</Label>
              <Textarea rows={3} value={(row.declaration as string) ?? ""} onChange={(e) => set("declaration", e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Remarks</Label>
              <Textarea rows={2} value={(row.remarks as string) ?? ""} onChange={(e) => set("remarks", e.target.value)} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={saving}>Save</Button>
          <Button onClick={() => save(true)} disabled={saving}>{saving ? "Working…" : "Save & Print"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
