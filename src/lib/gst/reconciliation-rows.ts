// 6.2: purchases in books against GSTR-2B for one month, read-only. Each row says which side is
// authoritative, so a reader does not "fix" the books to match a GSTR-2B line that is itself wrong.
//
// Rules for the authoritative side:
//  - In GSTR-2B but not in books: GSTR-2B decides whether input tax can be claimed. Do not record
//    the purchase unless the bill is held.
//  - In books but not in GSTR-2B: the books hold the purchase; GSTR-2B decides whether the credit is
//    available. Do not delete the purchase because of GSTR-2B.
//  - Same bill, different value, tax, date or number: the source invoice decides. Change the books
//    only to match the bill; if the bill agrees with the books, the supplier must correct GSTR-2B.

import { fetchVouchers, type VoucherRow } from "@/lib/gst-returns";
import { defaultSelection, resolveGstPeriod } from "@/lib/gst-period";
import { loadAllImportLines } from "@/lib/gstr2b-local-store";
import { g2bPeriodInRange } from "@/lib/gstr2b-periods";
import { reconcile, DEFAULT_TOLERANCES, type BookPurchase, type ParsedRow, type ReconResult } from "@/lib/gstr2b-recon";
import { GSTR3B_SCREEN_PATH } from "@/lib/gst/provisional-gst";

export type ReconSide = "gstr2b_only" | "books_only" | "mismatch";
export type ReconAuthority = "gstr2b" | "source_invoice";

export interface ReconRow {
  side: ReconSide;
  supplier: string;
  invoice_no: string;
  invoice_date: string | null;
  books_rupees: number | null;
  gstr2b_rupees: number | null;
  authoritative: ReconAuthority;
  authoritative_label: string;
  guidance: string;
  voucher_id: string | null;
}

export interface ReconCounts { matched: number; gstr2b_only: number; books_only: number; mismatch: number }

const MISMATCH_STATUSES = new Set(["value_mismatch", "tax_mismatch", "date_mismatch", "invoice_no_mismatch", "probable_match"]);

const GUIDE: Record<ReconSide, { authoritative: ReconAuthority; label: string; guidance: string }> = {
  gstr2b_only: {
    authoritative: "gstr2b",
    label: "GSTR-2B decides whether input tax can be claimed",
    guidance: "Not in your books. Record the purchase only if you hold this bill. Do not claim input tax on it until it appears in GSTR-2B.",
  },
  books_only: {
    authoritative: "gstr2b",
    label: "GSTR-2B decides whether input tax is available",
    guidance: "Recorded in your books but not in GSTR-2B. Do not delete the purchase because of GSTR-2B. Claim input tax only once it appears there; ask the supplier to file it if the bill is genuine.",
  },
  mismatch: {
    authoritative: "source_invoice",
    label: "the source invoice decides",
    guidance: "Books and GSTR-2B disagree on value, tax, date or number. Check the supplier's bill. Change the books only to match the bill. If the bill agrees with the books, ask the supplier to correct GSTR-2B.",
  },
};

function row(side: ReconSide, p: Partial<ReconRow>): ReconRow {
  const g = GUIDE[side];
  return {
    side,
    supplier: p.supplier ?? "",
    invoice_no: p.invoice_no ?? "",
    invoice_date: p.invoice_date ?? null,
    books_rupees: p.books_rupees ?? null,
    gstr2b_rupees: p.gstr2b_rupees ?? null,
    authoritative: g.authoritative,
    authoritative_label: g.label,
    guidance: g.guidance,
    voucher_id: p.voucher_id ?? null,
  };
}

/** Pure: turn reconcile() results and the book purchases into the rows a reader needs, with counts. */
export function classifyReconRows(results: ReconResult[], books: BookPurchase[]): { rows: ReconRow[]; counts: ReconCounts } {
  const rows: ReconRow[] = [];
  const counts: ReconCounts = { matched: 0, gstr2b_only: 0, books_only: 0, mismatch: 0 };
  const matchedBookIds = new Set<string>();

  for (const r of results) {
    if (r.matched_voucher_id) matchedBookIds.add(r.matched_voucher_id);
    const twoB = r.row.invoice_value_paise / 100;
    const base = { supplier: r.row.supplier_name || r.row.supplier_gstin, invoice_no: r.row.invoice_no, invoice_date: r.row.invoice_date, gstr2b_rupees: twoB, voucher_id: r.matched_voucher_id };
    if (r.match_status === "matched" || r.match_status === "matched_with_tolerance") {
      counts.matched++;
    } else if (r.match_status === "unmatched") {
      counts.gstr2b_only++;
      rows.push(row("gstr2b_only", { ...base, books_rupees: null }));
    } else if (MISMATCH_STATUSES.has(r.match_status)) {
      counts.mismatch++;
      const b = r.matched_voucher_id ? books.find((x) => x.id === r.matched_voucher_id) : undefined;
      rows.push(row("mismatch", { ...base, books_rupees: b ? b.total_paise / 100 : null }));
    }
  }

  for (const b of books) {
    if (matchedBookIds.has(b.id)) continue;
    counts.books_only++;
    rows.push(row("books_only", {
      supplier: b.ledgers?.name ?? "",
      invoice_no: b.vendor_invoice_no ?? b.voucher_number,
      invoice_date: b.voucher_date,
      books_rupees: b.total_paise / 100,
      gstr2b_rupees: null,
      voucher_id: b.id,
    }));
  }
  return { rows, counts };
}

export type GstReconStatus = "ok" | "no_import" | "refused";

export interface GstReconResult {
  status: GstReconStatus;
  reason?: string;
  period: { month: string; label: string; from: string; to: string; fp: string };
  rows: ReconRow[];
  counts: ReconCounts;
  screenPath: string;
}

/** Books against GSTR-2B for one month ("YYYY-MM"). Read-only. */
export async function gstReconciliation(companyId: string, month: string): Promise<GstReconResult> {
  const period = resolveGstPeriod({ ...defaultSelection("monthly"), mode: "month", month });
  const base = {
    period: { month, label: period.label, from: period.from, to: period.to, fp: period.fp },
    rows: [] as ReconRow[],
    counts: { matched: 0, gstr2b_only: 0, books_only: 0, mismatch: 0 },
    screenPath: GSTR3B_SCREEN_PATH,
  };
  if (!period.valid) return { ...base, status: "refused", reason: "Give the month as YYYY-MM." };

  const lines = (await loadAllImportLines(companyId)).filter((l) =>
    g2bPeriodInRange(l.gstr2b_period, l.import_period, { fps: [period.fp], from: period.from, to: period.to }),
  );
  if (lines.length === 0) {
    return {
      ...base,
      status: "no_import",
      reason: `No GSTR-2B has been imported for ${period.label}. Import it on the GSTR-2B screen to reconcile.`,
    };
  }

  const purchases = (await fetchVouchers(companyId, period.from, period.to, ["purchase"])) as VoucherRow[];
  const books: BookPurchase[] = purchases.map((v) => {
    const l = (v as unknown as { ledgers?: { name?: string; gstin?: string | null } | null }).ledgers;
    return {
      id: v.id,
      voucher_number: v.voucher_number,
      voucher_date: v.voucher_date,
      total_paise: v.total_paise,
      cgst_paise: v.cgst_paise,
      sgst_paise: v.sgst_paise,
      igst_paise: v.igst_paise,
      vendor_invoice_no: v.vendor_invoice_no,
      ledgers: l ? { name: l.name ?? "", gstin: l.gstin ?? null } : null,
    };
  });
  const parsed: ParsedRow[] = lines.map((l) => ({
    supplier_gstin: l.supplier_gstin,
    supplier_name: l.supplier_name ?? "",
    invoice_no: l.invoice_no,
    invoice_date: l.invoice_date,
    invoice_value_paise: l.invoice_value_paise,
    taxable_paise: l.taxable_paise,
    igst_paise: l.igst_paise,
    cgst_paise: l.cgst_paise,
    sgst_paise: l.sgst_paise,
    cess_paise: l.cess_paise,
  }));
  const results = reconcile(parsed, books, DEFAULT_TOLERANCES);
  const { rows, counts } = classifyReconRows(results, books);
  return { ...base, status: "ok", rows, counts };
}
