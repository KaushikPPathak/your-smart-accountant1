// GSTR-3B manual entries for the local-only build: inward supplies and ITC
// reversal per company and period. One row per (company, period, type), keyed
// by a fixed id so saving the same period again replaces the row.
import { offlineDb as db } from "@/lib/offline/db";

export interface InwardSummaryRow {
  ty: "GST" | "NONGST";
  inter_paise: number;
  intra_paise: number;
}

export interface ItcReversalRow {
  ty: "RUL" | "OTH";
  iamt_paise: number;
  camt_paise: number;
  samt_paise: number;
  csamt_paise: number;
}

const keyOf = (companyId: string, period: string, ty: string) => `${companyId}|${period}|${ty}`;

export async function fetchInwardSummaryLocal(companyId: string, period: string): Promise<InwardSummaryRow[]> {
  const rows: any[] = await db.cache_gstr3b_inward_summary.where("[company_id+period]").equals([companyId, period]).toArray();
  return rows.map((r) => ({ ty: r.ty, inter_paise: Number(r.inter_paise) || 0, intra_paise: Number(r.intra_paise) || 0 }));
}

export async function fetchItcReversalLocal(companyId: string, period: string): Promise<ItcReversalRow[]> {
  const rows: any[] = await db.cache_gstr3b_itc_reversal.where("[company_id+period]").equals([companyId, period]).toArray();
  return rows.map((r) => ({
    ty: r.ty,
    iamt_paise: Number(r.iamt_paise) || 0,
    camt_paise: Number(r.camt_paise) || 0,
    samt_paise: Number(r.samt_paise) || 0,
    csamt_paise: Number(r.csamt_paise) || 0,
  }));
}

export async function saveGstr3bManualLocal(
  companyId: string,
  period: string,
  inward: InwardSummaryRow[],
  reversal: ItcReversalRow[],
): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", [db.cache_gstr3b_inward_summary, db.cache_gstr3b_itc_reversal], async () => {
    for (const r of inward) {
      await db.cache_gstr3b_inward_summary.put({
        id: keyOf(companyId, period, r.ty), company_id: companyId, period, ...r, updated_at: now,
      });
    }
    for (const r of reversal) {
      await db.cache_gstr3b_itc_reversal.put({
        id: keyOf(companyId, period, r.ty), company_id: companyId, period, ...r, updated_at: now,
      });
    }
  });
}
