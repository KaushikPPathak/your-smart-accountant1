// Local item movements for reports (HSN summary, ITC item-wise). Reads only this
// PC's books, so the reports work offline and in local-only mode.
import { readItems, readVouchers, readVoucherItemsForCompany } from "@/lib/offline/cache-read";

export interface LocalItemRow {
  id: string;
  name: string;
  unit: string;
  hsn_code: string | null;
  gst_rate: number;
  opening_stock_qty: number;
  opening_stock_rate_paise: number;
}

/** One voucher line for an item, with its voucher's type and date. Same shape the reports used from the cloud. */
export interface LocalItemMove {
  item_id: string;
  qty: number;
  rate_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  vouchers: { voucher_type: string; voucher_date: string; company_id: string };
}

export async function readItemRowsLocal(companyId: string): Promise<LocalItemRow[]> {
  const rows = (await readItems(companyId)) as any[];
  return rows.map((i) => ({
    id: String(i.id),
    name: String(i.name ?? ""),
    unit: String(i.unit ?? ""),
    hsn_code: i.hsn_code ?? null,
    gst_rate: Number(i.gst_rate) || 0,
    opening_stock_qty: Number(i.opening_stock_qty) || 0,
    opening_stock_rate_paise: Number(i.opening_stock_rate_paise) || 0,
  }));
}

/** Item lines of non-deleted vouchers dated within [from, to] (from is optional). */
export async function readItemMovesLocal(companyId: string, opts: { from?: string; to: string }): Promise<LocalItemMove[]> {
  const vouchersPromise = readVouchers(companyId, { from: opts.from, to: opts.to });
  const [vouchers, lines] = await Promise.all([vouchersPromise, readVoucherItemsForCompany(companyId, vouchersPromise)]);
  const byId = new Map((vouchers as any[]).map((v) => [String(v.id), v]));
  const out: LocalItemMove[] = [];
  for (const l of lines as any[]) {
    const v = byId.get(String(l.voucher_id));
    if (!v) continue;
    out.push({
      item_id: String(l.item_id ?? ""),
      qty: Number(l.qty) || 0,
      rate_paise: Number(l.rate_paise) || 0,
      taxable_paise: Number(l.taxable_paise) || 0,
      cgst_paise: Number(l.cgst_paise) || 0,
      sgst_paise: Number(l.sgst_paise) || 0,
      igst_paise: Number(l.igst_paise) || 0,
      vouchers: {
        voucher_type: String(v.voucher_type ?? ""),
        voucher_date: String(v.voucher_date ?? ""),
        company_id: companyId,
      },
    });
  }
  return out;
}
