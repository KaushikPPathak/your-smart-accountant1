// E-Way Bill / E-Invoice preparation dialog.
// Builds the canonical EWB Part-A JSON payload + IRP invoice JSON so the user
// can copy-paste into the GST/EWB portal (or hand to a GSP) and stores the
// generated IRN/EWB numbers locally for the invoice PDF.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Download, Truck, FileCode2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { upsertEinvoice, ddmmyyyy } from "@/lib/einvoice";
import { formatINR } from "@/lib/money";
import { INDIAN_STATES } from "@/lib/constants";
import { toast } from "sonner";

interface VoucherSnapshot {
  id: string;
  company_id: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  is_interstate: boolean;
  place_of_supply_code: string | null;
}

const SUPPLY_TYPES = [
  { v: "O", label: "Outward" },
  { v: "I", label: "Inward" },
];
const SUB_TYPES = [
  { v: "1", label: "Supply" },
  { v: "2", label: "Export" },
  { v: "3", label: "Job Work" },
  { v: "4", label: "SKD/CKD" },
  { v: "5", label: "Recipient Not Known" },
  { v: "6", label: "For Own Use" },
  { v: "7", label: "Exhibition or Fairs" },
  { v: "8", label: "Line Sales" },
  { v: "9", label: "Others" },
];
const DOC_TYPES = [
  { v: "INV", label: "Tax Invoice" },
  { v: "BIL", label: "Bill of Supply" },
  { v: "CHL", label: "Delivery Challan" },
  { v: "CNT", label: "Credit Note" },
];
const TRANS_MODES = [
  { v: "1", label: "Road" },
  { v: "2", label: "Rail" },
  { v: "3", label: "Air" },
  { v: "4", label: "Ship" },
];
const VEHICLE_TYPES = [
  { v: "R", label: "Regular" },
  { v: "O", label: "Over Dimensional Cargo" },
];

export function EwayBillPrepDialog({
  open,
  onOpenChange,
  voucher,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  voucher: VoucherSnapshot | null;
  onSaved?: () => void;
}) {
  const [supplyType, setSupplyType] = useState("O");
  const [subType, setSubType] = useState("1");
  const [docType, setDocType] = useState("INV");
  const [transMode, setTransMode] = useState("1");
  const [vehicleType, setVehicleType] = useState("R");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [transDocNo, setTransDocNo] = useState("");
  const [transDocDate, setTransDocDate] = useState("");
  const [distance, setDistance] = useState("");
  const [fromPin, setFromPin] = useState("");
  const [fromPlace, setFromPlace] = useState("");
  const [fromState, setFromState] = useState("");
  const [toPin, setToPin] = useState("");
  const [toPlace, setToPlace] = useState("");
  const [toState, setToState] = useState("");
  const [irn, setIrn] = useState("");
  const [ackNo, setAckNo] = useState("");
  const [ewbNo, setEwbNo] = useState("");
  const [ewbValid, setEwbValid] = useState("");
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<{ name: string; gstin: string | null; address: string | null; state_code: string | null; pin?: string | null } | null>(null);
  const [party, setParty] = useState<{ name: string; gstin: string | null; address: string | null; state_code: string | null } | null>(null);

  useEffect(() => {
    if (!open || !voucher) return;
    (async () => {
      const [co, v] = await Promise.all([
        supabase.from("companies").select("name, gstin, address, state_code").eq("id", voucher.company_id).single(),
        supabase.from("vouchers").select("party_ledger_id, ledgers:party_ledger_id(name, gstin, address, state_code)").eq("id", voucher.id).single(),
      ]);
      const c = co.data as { name: string; gstin: string | null; address: string | null; state_code: string | null } | null;
      setCompany(c);
      const p = (v.data as { ledgers: { name: string; gstin: string | null; address: string | null; state_code: string | null } | null } | null)?.ledgers ?? null;
      setParty(p);
      setFromState(c?.state_code ?? "");
      setFromPlace(c?.address?.split(",").slice(-2)[0]?.trim() ?? "");
      setToState(voucher.place_of_supply_code ?? p?.state_code ?? "");
      setToPlace(p?.address?.split(",").slice(-2)[0]?.trim() ?? "");
      // Existing record
      const { data: ex } = await supabase
        .from("einvoice_details")
        .select("irn, ack_no, ewb_no, ewb_valid_until, vehicle_no, transporter_name, transporter_id, distance_km")
        .eq("voucher_id", voucher.id)
        .maybeSingle();
      if (ex) {
        setIrn(ex.irn ?? "");
        setAckNo(ex.ack_no ?? "");
        setEwbNo(ex.ewb_no ?? "");
        setEwbValid(ex.ewb_valid_until ? new Date(ex.ewb_valid_until).toISOString().slice(0, 16) : "");
        setVehicleNo(ex.vehicle_no ?? "");
        setTransporterName(ex.transporter_name ?? "");
        setTransporterId(ex.transporter_id ?? "");
        setDistance(ex.distance_km ? String(ex.distance_km) : "");
      }
    })();
  }, [open, voucher]);

  const ewbPayload = useMemo(() => {
    if (!voucher || !company || !party) return null;
    return {
      supplyType,
      subSupplyType: subType,
      docType,
      docNo: voucher.voucher_number,
      docDate: ddmmyyyy(voucher.voucher_date),
      fromGstin: company.gstin || "URP",
      fromTrdName: company.name,
      fromAddr1: (company.address || "").slice(0, 120),
      fromPlace,
      fromPincode: Number(fromPin) || 0,
      fromStateCode: Number(fromState) || 0,
      actualFromStateCode: Number(fromState) || 0,
      toGstin: party.gstin || "URP",
      toTrdName: party.name,
      toAddr1: (party.address || "").slice(0, 120),
      toPlace,
      toPincode: Number(toPin) || 0,
      toStateCode: Number(toState) || 0,
      actualToStateCode: Number(toState) || 0,
      totalValue: Math.round(voucher.subtotal_paise / 100),
      cgstValue: Math.round(voucher.cgst_paise / 100),
      sgstValue: Math.round(voucher.sgst_paise / 100),
      igstValue: Math.round(voucher.igst_paise / 100),
      cessValue: 0,
      totInvValue: Math.round(voucher.total_paise / 100),
      transMode: Number(transMode),
      transDistance: String(Number(distance) || 0),
      transporterName,
      transporterId,
      transDocNo,
      transDocDate: transDocDate ? ddmmyyyy(transDocDate) : "",
      vehicleNo: vehicleNo.replace(/\s/g, "").toUpperCase(),
      vehicleType,
    };
  }, [voucher, company, party, supplyType, subType, docType, fromPlace, fromPin, fromState, toPlace, toPin, toState, transMode, distance, transporterName, transporterId, transDocNo, transDocDate, vehicleNo, vehicleType]);

  const irpPayload = useMemo(() => {
    if (!voucher || !company || !party) return null;
    return {
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: party.gstin ? "B2B" : "B2C", RegRev: "N" },
      DocDtls: { Typ: docType === "CNT" ? "CRN" : "INV", No: voucher.voucher_number, Dt: ddmmyyyy(voucher.voucher_date) },
      SellerDtls: { Gstin: company.gstin || "", LglNm: company.name, Addr1: company.address || "", Loc: fromPlace, Pin: Number(fromPin) || 0, Stcd: company.state_code || "" },
      BuyerDtls: { Gstin: party.gstin || "URP", LglNm: party.name, Pos: voucher.place_of_supply_code || party.state_code || "", Addr1: party.address || "", Loc: toPlace, Pin: Number(toPin) || 0, Stcd: party.state_code || "" },
      ValDtls: {
        AssVal: Math.round(voucher.subtotal_paise / 100),
        CgstVal: Math.round(voucher.cgst_paise / 100),
        SgstVal: Math.round(voucher.sgst_paise / 100),
        IgstVal: Math.round(voucher.igst_paise / 100),
        CesVal: 0,
        RndOffAmt: 0,
        TotInvVal: Math.round(voucher.total_paise / 100),
      },
    };
  }, [voucher, company, party, docType, fromPlace, fromPin, toPlace, toPin]);

  const requiresEwb = (voucher?.total_paise ?? 0) > 5_000_000; // ₹50,000 in paise

  async function save() {
    if (!voucher) return;
    setSaving(true);
    try {
      await upsertEinvoice({
        voucherId: voucher.id,
        companyId: voucher.company_id,
        irn: irn || undefined,
        ackNo: ackNo || undefined,
        status: irn ? "generated" : "pending",
        ewbNo: ewbNo || undefined,
        ewbValidUntil: ewbValid || undefined,
        vehicleNo: vehicleNo || undefined,
        transporterName: transporterName || undefined,
        transporterId: transporterId || undefined,
        distanceKm: distance ? Number(distance) : undefined,
      });
      toast.success("E-Way Bill / E-Invoice details saved");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function copyJson(data: unknown, label: string) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success(`${label} JSON copied`);
  }
  function downloadJson(data: unknown, name: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!voucher) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> E-Way Bill & E-Invoice — {voucher.voucher_number}
            {requiresEwb && <Badge variant="destructive">EWB Required (&gt; ₹50,000)</Badge>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Invoice value <span className="font-mono">{formatINR(voucher.total_paise)}</span>.
            {requiresEwb
              ? " For inter-state movement, or intra-state movement beyond 50 km/city limit, an E-Way Bill is mandatory."
              : " E-Way Bill optional — invoice below ₹50,000 threshold."}
          </p>
        </DialogHeader>

        <Tabs defaultValue="ewb">
          <TabsList>
            <TabsTrigger value="ewb"><Truck className="h-3 w-3 mr-1" /> E-Way Bill</TabsTrigger>
            <TabsTrigger value="einv"><FileCode2 className="h-3 w-3 mr-1" /> E-Invoice (IRN)</TabsTrigger>
            <TabsTrigger value="json">Payload JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="ewb" className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Supply Type">
                <Select value={supplyType} onValueChange={setSupplyType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUPPLY_TYPES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Sub-type">
                <Select value={subType} onValueChange={setSubType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUB_TYPES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Doc Type">
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DOC_TYPES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">From (Dispatch)</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Place"><Input value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} /></Field>
                <Field label="PIN code"><Input value={fromPin} onChange={(e) => setFromPin(e.target.value)} placeholder="6 digits" /></Field>
                <Field label="State">
                  <Select value={fromState} onValueChange={setFromState}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="max-h-72">{INDIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">To (Ship-to)</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Place"><Input value={toPlace} onChange={(e) => setToPlace(e.target.value)} /></Field>
                <Field label="PIN code"><Input value={toPin} onChange={(e) => setToPin(e.target.value)} placeholder="6 digits" /></Field>
                <Field label="State">
                  <Select value={toState} onValueChange={setToState}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="max-h-72">{INDIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Transport</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Mode">
                  <Select value={transMode} onValueChange={setTransMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TRANS_MODES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Distance (km)"><Input value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="e.g. 120" /></Field>
                <Field label="Vehicle No."><Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} placeholder="MH12AB1234" /></Field>
                <Field label="Vehicle Type">
                  <Select value={vehicleType} onValueChange={setVehicleType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{VEHICLE_TYPES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Transporter Name"><Input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} /></Field>
                <Field label="Transporter ID (GSTIN/TRANSIN)"><Input value={transporterId} onChange={(e) => setTransporterId(e.target.value.toUpperCase())} /></Field>
                <Field label="LR / Doc No."><Input value={transDocNo} onChange={(e) => setTransDocNo(e.target.value)} /></Field>
                <Field label="LR Date"><Input type="date" value={transDocDate} onChange={(e) => setTransDocDate(e.target.value)} /></Field>
              </div>
            </div>

            <div className="rounded border p-3 space-y-2 bg-muted/40">
              <div className="text-xs font-semibold text-muted-foreground">EWB Number (after generation on portal)</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="EWB No."><Input value={ewbNo} onChange={(e) => setEwbNo(e.target.value)} placeholder="12-digit EWB no." /></Field>
                <Field label="Valid until"><Input type="datetime-local" value={ewbValid} onChange={(e) => setEwbValid(e.target.value)} /></Field>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="einv" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              For B2B invoices when company turnover > ₹5 Cr, generate IRN on the IRP portal and paste below. Values appear on the invoice PDF and are kept as audit trail.
            </p>
            <Field label="IRN (64-char hash)"><Input value={irn} onChange={(e) => setIrn(e.target.value)} placeholder="Paste IRN" /></Field>
            <Field label="Acknowledgement No."><Input value={ackNo} onChange={(e) => setAckNo(e.target.value)} /></Field>
          </TabsContent>

          <TabsContent value="json" className="space-y-3">
            <div className="rounded border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">E-Way Bill payload</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => copyJson(ewbPayload, "EWB")}><Copy className="h-3 w-3 mr-1" />Copy</Button>
                  <Button size="sm" variant="outline" onClick={() => downloadJson(ewbPayload, `ewb_${voucher.voucher_number}.json`)}><Download className="h-3 w-3 mr-1" />Download</Button>
                </div>
              </div>
              <Textarea readOnly className="font-mono text-xs h-48" value={JSON.stringify(ewbPayload, null, 2)} />
            </div>
            <div className="rounded border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">IRP (E-Invoice) payload</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => copyJson(irpPayload, "IRP")}><Copy className="h-3 w-3 mr-1" />Copy</Button>
                  <Button size="sm" variant="outline" onClick={() => downloadJson(irpPayload, `irp_${voucher.voucher_number}.json`)}><Download className="h-3 w-3 mr-1" />Download</Button>
                </div>
              </div>
              <Textarea readOnly className="font-mono text-xs h-48" value={JSON.stringify(irpPayload, null, 2)} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
