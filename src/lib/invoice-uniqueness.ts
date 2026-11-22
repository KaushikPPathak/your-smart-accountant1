// Invoice-number uniqueness, checked before a voucher is saved.
//
// Scope:
//   sales, credit note, debit note  → the invoice number (voucher_number) within the company and
//                                     financial year, per voucher type
//   purchase                        → the supplier's bill number (reference_no) within the company,
//                                     the supplier and the financial year. A repeated supplier bill
//                                     would claim its input tax twice.
// A company has one GSTIN, so the company scope is the GSTIN scope.
//
// Normalisation: trimmed, upper case, spaces removed, and leading zeros dropped from each digit run.
// Separators (/ - .) are kept, so "INV/2/11" and "INV/21/1" stay different.

export interface InvoiceRow {
  id: string;
  voucher_type: string;
  voucher_date: string;
  voucher_number: string | null;
  reference_no: string | null;
  party_ledger_id: string | null;
  is_deleted?: boolean | null;
}

export interface InvoiceCandidate {
  voucherId?: string | null;
  voucherType: string;
  voucherDate: string;
  /** Typed invoice number for sales-side types; supplier bill number for purchases. */
  number: string;
  partyId?: string | null;
}

export function normalizeInvoiceNumber(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\d+/g, (d) => String(parseInt(d, 10)));
}

/** Financial year label, e.g. "2026-27" for dates from 1 April 2026 to 31 March 2027. */
export function financialYearOf(isoDate: string): string {
  const [y, m] = String(isoDate).split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const SALES_SIDE = new Set(["sales", "credit_note", "debit_note"]);

/** Existing live vouchers that would share this candidate's invoice number. */
export function findDuplicateInvoice(candidate: InvoiceCandidate, existing: InvoiceRow[]): InvoiceRow[] {
  const wanted = normalizeInvoiceNumber(candidate.number);
  if (!wanted) return [];
  const fy = financialYearOf(candidate.voucherDate);
  const isPurchase = candidate.voucherType === "purchase";
  if (!isPurchase && !SALES_SIDE.has(candidate.voucherType)) return [];
  return existing.filter((v) => {
    if (v.is_deleted) return false;
    if (candidate.voucherId && v.id === candidate.voucherId) return false;
    if (v.voucher_type !== candidate.voucherType) return false;
    if (financialYearOf(v.voucher_date) !== fy) return false;
    if (isPurchase && String(v.party_ledger_id ?? "") !== String(candidate.partyId ?? "")) return false;
    const field = isPurchase ? v.reference_no : v.voucher_number;
    return normalizeInvoiceNumber(field ?? "") === wanted;
  });
}
