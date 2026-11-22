// 7.3: which vouchers must carry a document reference, an instrument reference, or a cost centre.
// A reference is what lets a voucher be traced to its source document in an audit or a GST notice.
// Cost centres are for management reporting, so tax, round-off and tax-payment entries never need one.
// Cost-centre rule applies where the line form supports it. Enforcement is off until the item and entry
// forms capture a cost centre per line (backlog: add that field, then enable it here).

export interface RequirementInput {
  voucherType: string;
  /** Document reference: supplier bill number, invoice number, original invoice, or journal reference. */
  documentRef?: string | null;
  /** Instrument reference (cheque number, UTR, transaction id) for a bank-mode payment or receipt. */
  instrumentRef?: string | null;
  /** The voucher moves money through a bank ledger (not cash). */
  bankMode?: boolean;
  /** The voucher posts to at least one expense ledger. */
  expenseSide?: boolean;
  /** The voucher is only tax, tax payment or round-off. */
  taxOnly?: boolean;
  /** Cost centres are enabled for this company (see shouldShowCostCentre). */
  costCentresEnabled?: boolean;
  costCentreId?: string | null;
}

const DOCUMENT_REF_TYPES = new Set(["sales", "purchase", "credit_note", "debit_note", "journal"]);
const INSTRUMENT_TYPES = new Set(["payment", "receipt"]);
const COST_CENTRE_TYPES = new Set(["purchase", "payment", "journal"]);

/** Messages for what is missing. Empty when the voucher can be saved. */
export function missingRequirements(input: RequirementInput): string[] {
  const out: string[] = [];
  if (DOCUMENT_REF_TYPES.has(input.voucherType) && !String(input.documentRef ?? "").trim()) {
    out.push(
      input.voucherType === "purchase"
        ? "Enter the supplier's bill number."
        : input.voucherType === "journal"
          ? "Enter a reference for this journal (document or bill number)."
          : "Enter the document reference for this voucher.",
    );
  }
  if (INSTRUMENT_TYPES.has(input.voucherType) && input.bankMode && !String(input.instrumentRef ?? "").trim()) {
    out.push("Enter the cheque number, UTR or transaction ID for this bank entry.");
  }
  if (
    input.costCentresEnabled &&
    COST_CENTRE_TYPES.has(input.voucherType) &&
    input.expenseSide &&
    !input.taxOnly &&
    !input.costCentreId
  ) {
    out.push("Tag an expense cost centre on this voucher.");
  }
  return out;
}
