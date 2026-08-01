// Phase E4 — GSTR-2B reconciliation storage, local-only.
//
// The downloaded 2B file and every match decision live in IndexedDB on this
// device. Nothing is sent to a server, matching the app's local-only data rule.
import { offlineDb } from "@/lib/offline/db";
import { readVouchers, readLedgers } from "@/lib/offline/cache-read";

export interface G2BImport {
  id: string;
  company_id: string;
  period: string;
  source: string;
  file_name: string;
  total_lines: number;
  matched_lines: number;
  created_at: string;
}

export interface G2BLineRow {
  id: string;
  import_id: string;
  company_id: string;
  supplier_gstin: string;
  supplier_name: string | null;
  invoice_no: string;
  invoice_date: string | null;
  invoice_value_paise: number;
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
  match_status: string;
  matched_voucher_id: string | null;
  remarks: string | null;
  manual_override: boolean;
}

export interface LocalPurchase {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
  vendor_invoice_no: string | null;
  ledgers: { name: string; gstin: string | null } | null;
}

function uid(): string {
  return (crypto as any)?.randomUUID?.() ?? `g2b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Purchase vouchers with their party name + GSTIN, read from the local cache. */
export async function loadLocalPurchases(companyId: string): Promise<LocalPurchase[]> {
  const [vouchers, ledgers] = await Promise.all([readVouchers(companyId), readLedgers(companyId)]);
  const byId = new Map<string, any>();
  for (const l of ledgers as any[]) byId.set(String(l.id), l);
  return (vouchers as any[])
    .filter((v) => String(v.voucher_type || "").toLowerCase() === "purchase" && !v.is_deleted)
    .map((v) => {
      const party = v.party_ledger_id ? byId.get(String(v.party_ledger_id)) : null;
      return {
        id: String(v.id),
        voucher_number: String(v.voucher_number || ""),
        voucher_date: String(v.voucher_date || ""),
        total_paise: Number(v.total_paise || 0),
        vendor_invoice_no: v.vendor_invoice_no ? String(v.vendor_invoice_no) : null,
        ledgers: party ? { name: String(party.name || ""), gstin: party.gstin ? String(party.gstin) : null } : null,
      };
    })
    .sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : -1));
}

export async function latestImport(companyId: string): Promise<G2BImport | null> {
  const rows = (await offlineDb.cache_gstr2b_imports.where("company_id").equals(companyId).toArray()) as G2BImport[];
  if (!rows.length) return null;
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

export async function loadImportLines(importId: string): Promise<G2BLineRow[]> {
  const rows = (await offlineDb.cache_gstr2b_lines.where("import_id").equals(importId).toArray()) as G2BLineRow[];
  return rows;
}

export async function saveImport(
  companyId: string,
  period: string,
  source: string,
  fileName: string,
  lines: Omit<G2BLineRow, "id" | "import_id" | "company_id" | "remarks" | "manual_override">[],
  matchedCount: number,
): Promise<G2BImport> {
  const imp: G2BImport = {
    id: uid(),
    company_id: companyId,
    period,
    source,
    file_name: fileName,
    total_lines: lines.length,
    matched_lines: matchedCount,
    created_at: new Date().toISOString(),
  };
  const rows: G2BLineRow[] = lines.map((l) => ({
    ...l,
    id: uid(),
    import_id: imp.id,
    company_id: companyId,
    remarks: null,
    manual_override: false,
  }));
  await offlineDb.cache_gstr2b_imports.put(imp);
  await offlineDb.cache_gstr2b_lines.bulkPut(rows);
  return imp;
}

export async function patchG2BLine(id: string, patch: Partial<G2BLineRow>): Promise<void> {
  await offlineDb.cache_gstr2b_lines.update(id, patch);
}

export async function deleteImport(importId: string): Promise<void> {
  const rows = (await offlineDb.cache_gstr2b_lines.where("import_id").equals(importId).toArray()) as G2BLineRow[];
  await offlineDb.cache_gstr2b_lines.bulkDelete(rows.map((r) => r.id));
  await offlineDb.cache_gstr2b_imports.delete(importId);
}
