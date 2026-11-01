// E-invoice and e-way bill details for the local-only build. One record per
// voucher, kept in this PC's books.
import { offlineDb as db } from "@/lib/offline/db";

export interface EinvoiceDetailsLocal {
  voucher_id: string;
  company_id: string;
  irn: string | null;
  ack_no: string | null;
  ack_date: string | null;
  signed_qr: string | null;
  status: string;
  ewb_no: string | null;
  ewb_valid_until: string | null;
  vehicle_no: string | null;
  transporter_name: string | null;
  transporter_id: string | null;
  distance_km: number | null;
}

export async function upsertEinvoiceLocal(a: {
  voucherId: string;
  companyId: string;
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedQr?: string;
  status?: string;
  ewbNo?: string;
  ewbValidUntil?: string;
  vehicleNo?: string;
  transporterName?: string;
  transporterId?: string;
  distanceKm?: number;
}): Promise<void> {
  // Keep fields that were not passed in this save, as the cloud upsert did
  // when it sent only the given values.
  const prev: any = await db.cache_einvoice_details.get(a.voucherId);
  await db.cache_einvoice_details.put({
    voucher_id: a.voucherId,
    company_id: a.companyId,
    irn: a.irn ?? prev?.irn ?? null,
    ack_no: a.ackNo ?? prev?.ack_no ?? null,
    ack_date: a.ackDate ?? prev?.ack_date ?? null,
    signed_qr: a.signedQr ?? prev?.signed_qr ?? null,
    status: a.status ?? "generated",
    ewb_no: a.ewbNo ?? prev?.ewb_no ?? null,
    ewb_valid_until: a.ewbValidUntil ?? prev?.ewb_valid_until ?? null,
    vehicle_no: a.vehicleNo ?? prev?.vehicle_no ?? null,
    transporter_name: a.transporterName ?? prev?.transporter_name ?? null,
    transporter_id: a.transporterId ?? prev?.transporter_id ?? null,
    distance_km: a.distanceKm ?? prev?.distance_km ?? null,
    updated_at: new Date().toISOString(),
  });
}

export async function getEinvoiceDetailLocal(voucherId: string): Promise<EinvoiceDetailsLocal | null> {
  const row: any = await db.cache_einvoice_details.get(voucherId);
  return row ? (row as EinvoiceDetailsLocal) : null;
}

export async function getEinvoiceDetailsByVoucherLocal(companyId: string): Promise<Map<string, EinvoiceDetailsLocal>> {
  const rows: any[] = await db.cache_einvoice_details.where("company_id").equals(companyId).toArray();
  return new Map(rows.map((r) => [String(r.voucher_id), r as EinvoiceDetailsLocal]));
}

/** Sales vouchers of a company, newest first, with their party (for the e-invoice list). */
export async function listSalesVouchersLocal(companyId: string, limit = 200): Promise<any[]> {
  const [vouchers, ledgers, details] = await Promise.all([
    db.cache_vouchers.where("company_id").equals(companyId).toArray() as Promise<any[]>,
    db.cache_ledgers.where("company_id").equals(companyId).toArray() as Promise<any[]>,
    getEinvoiceDetailsByVoucherLocal(companyId),
  ]);
  const ledgerById = new Map(ledgers.map((l) => [String(l.id), l]));
  return vouchers
    .filter((v) => v.voucher_type === "sales" && !v.is_deleted && !v.deleted_at)
    .sort((a, b) => {
      const byDate = String(b.voucher_date).localeCompare(String(a.voucher_date));
      return byDate || String(b.voucher_number).localeCompare(String(a.voucher_number));
    })
    .slice(0, limit)
    .map((v) => {
      const party = v.party_ledger_id ? ledgerById.get(String(v.party_ledger_id)) : null;
      const d = details.get(String(v.id));
      return {
        ...v,
        ledgers: party ? { name: party.name, gstin: party.gstin ?? null } : null,
        einvoice_details: d
          ? { irn: d.irn, status: d.status, ewb_no: d.ewb_no, ewb_valid_until: d.ewb_valid_until }
          : null,
      };
    });
}

/** Company, voucher and party details used by the e-way bill dialog. */
export async function getEwbContextLocal(companyId: string, voucherId: string) {
  const company: any = await db.cache_companies.get(companyId);
  const voucher: any = await db.cache_vouchers.get(voucherId);
  const party: any = voucher?.party_ledger_id ? await db.cache_ledgers.get(voucher.party_ledger_id) : null;
  return {
    company: company
      ? { name: company.name, gstin: company.gstin ?? null, address: company.address ?? null, state_code: company.state_code ?? null }
      : null,
    voucher: voucher ? { party_ledger_id: voucher.party_ledger_id ?? null, place_of_supply_code: voucher.place_of_supply_code ?? null } : null,
    party: party
      ? { name: party.name, gstin: party.gstin ?? null, address: party.address ?? null, state_code: party.state_code ?? null }
      : null,
  };
}
