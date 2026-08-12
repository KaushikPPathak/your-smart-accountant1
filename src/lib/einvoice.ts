// E-Invoice (IRP) and E-way Bill helpers — local payload builder + QR data URL.
// NOTE: actual IRP integration requires GSP API credentials. This module produces
// the canonical IRP JSON shape so it can be sent to a GSP later, and stores the
// generated IRN/QR locally once received.
import { supabase } from "@/integrations/supabase/client";

export interface IrpInvoiceLine {
  SlNo: string;
  PrdDesc: string;
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesAmt: number;
  TotItemVal: number;
}

export interface IrpInvoice {
  Version: "1.1";
  TranDtls: { TaxSch: "GST"; SupTyp: "B2B" | "B2C" | "EXPWP" | "EXPWOP" | "SEZWP" | "SEZWOP"; RegRev?: "Y" | "N" };
  DocDtls: { Typ: "INV" | "CRN" | "DBN"; No: string; Dt: string }; // Dt = dd/mm/yyyy
  SellerDtls: { Gstin: string; LglNm: string; Addr1: string; Loc: string; Pin: number; Stcd: string };
  BuyerDtls: { Gstin: string; LglNm: string; Pos: string; Addr1: string; Loc: string; Pin: number; Stcd: string };
  ItemList: IrpInvoiceLine[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
}

export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export interface SaveEinvoiceArgs {
  voucherId: string;
  companyId: string;
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedQr?: string;
  status?: "pending" | "generated" | "cancelled" | "failed";
  ewbNo?: string;
  ewbValidUntil?: string;
  vehicleNo?: string;
  transporterName?: string;
  transporterId?: string;
  distanceKm?: number;
}

export async function upsertEinvoice(a: SaveEinvoiceArgs): Promise<void> {
  await supabase.from("einvoice_details").upsert(
    {
      voucher_id: a.voucherId,
      company_id: a.companyId,
      irn: a.irn ?? null,
      ack_no: a.ackNo ?? null,
      ack_date: a.ackDate ?? null,
      signed_qr: a.signedQr ?? null,
      status: a.status ?? "generated",
      ewb_no: a.ewbNo ?? null,
      ewb_valid_until: a.ewbValidUntil ?? null,
      vehicle_no: a.vehicleNo ?? null,
      transporter_name: a.transporterName ?? null,
      transporter_id: a.transporterId ?? null,
      distance_km: a.distanceKm ?? null,
    },
    { onConflict: "voucher_id" },
  );
}
