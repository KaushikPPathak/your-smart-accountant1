// 6.3: which transactions lack a valid GSTIN or an HSN/SAC code. Read-only and advisory: the list
// points to the rows. "Valid" here means present and well-formed; it is not verified with the tax
// authority, and the answer says so.
import { fetchVouchers, type VoucherRow } from "@/lib/gst-returns";

export interface TaxComplianceIssue {
  kind: "party_gstin" | "hsn";
  message: string;
  voucher_id: string;
  voucher_number: string;
  voucher_date: string;
  party: string;
}

export interface TaxComplianceReport {
  advisory: true;
  note: string;
  issues: TaxComplianceIssue[];
  total: number;
  from: string | null;
  to: string | null;
}

const MAX_ROWS = 50;
const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Format check only: 15 characters in the GSTIN pattern. Not verified with the GST portal. */
export function isWellFormedGstin(g: string | null | undefined): boolean {
  return GSTIN_FORMAT.test(String(g ?? "").trim().toUpperCase());
}

const DATE_FROM = "1900-01-01";
const DATE_TO = "2999-12-31";

export async function taxComplianceIssues(companyId: string, from?: string, to?: string): Promise<TaxComplianceReport> {
  const f = from ?? DATE_FROM;
  const t = to ?? DATE_TO;
  const vouchers = (await fetchVouchers(companyId, f, t, ["sales", "purchase", "credit_note", "debit_note"])) as VoucherRow[];
  const issues: TaxComplianceIssue[] = [];

  for (const v of vouchers) {
    const taxable = !v.supply_nature || v.supply_nature === "taxable" || v.supply_nature === "zero_rated_wp" || v.supply_nature === "zero_rated_wop";
    const party = v.ledgers?.name ?? "";
    const base = { voucher_id: v.id, voucher_number: v.voucher_number, voucher_date: v.voucher_date, party };

    // A registered party needs a well-formed GSTIN for a taxable supply.
    if (taxable && v.ledgers?.gst_treatment === "regular" && !isWellFormedGstin(v.ledgers.gstin)) {
      issues.push({
        kind: "party_gstin",
        message: v.ledgers.gstin ? "Party GSTIN is not well-formed." : "Registered party has no GSTIN.",
        ...base,
      });
    }

    // A taxable line needs an HSN or SAC code.
    if (taxable) {
      const missing = v.voucher_items.filter((l) => !String(l.items?.hsn_code ?? "").trim()).length;
      if (missing > 0) {
        issues.push({
          kind: "hsn",
          message: `${missing} line${missing === 1 ? "" : "s"} without an HSN or SAC code.`,
          ...base,
        });
      }
    }
  }

  return {
    advisory: true,
    note: "Advisory only. Presence and format are checked, not validity with the GST portal. The save screens enforce these where they can.",
    issues: issues.slice(0, MAX_ROWS),
    total: issues.length,
    from: from ?? null,
    to: to ?? null,
  };
}
