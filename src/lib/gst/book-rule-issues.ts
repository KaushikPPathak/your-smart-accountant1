// 6.2 / 6.3: rule checks for chat. ADVISORY ONLY. This explains what would fail and points to the rows.
// It never blocks, locks or writes. The save and report screens enforce these rules; a check that
// lives only here would be skipped by anyone who never opens chat.
import { readLedgers, readVouchers } from "@/lib/offline/cache-read";
import { missingRequirements } from "@/lib/voucher-requirements";
import { ledgerTypeMismatches } from "@/lib/ledger-type-check";

export interface BookRuleIssue {
  kind: "reference" | "ledger_type";
  message: string;
  voucher_id?: string;
  voucher_number?: string;
  voucher_date?: string;
  ledger?: string;
}

export interface BookRuleReport {
  advisory: true;
  note: string;
  issues: BookRuleIssue[];
  /** Total issues found, which can exceed the rows returned. */
  total: number;
}

const MAX_ROWS = 50;

/** Advisory list of voucher reference and ledger-type failures in a date range. */
export async function bookRuleIssues(companyId: string, from?: string, to?: string): Promise<BookRuleReport> {
  const vouchers = (await readVouchers(companyId, { from, to })) as any[];
  const issues: BookRuleIssue[] = [];

  for (const v of vouchers) {
    const type = String(v.voucher_type ?? "");
    const documentRef = type === "purchase" ? (v.vendor_invoice_no ?? v.reference_no) : v.voucher_number;
    // Instrument references (cheque, UTR) are enforced at save only: the cached voucher does not
    // record whether a bank ledger was used, so the advisory cannot judge them reliably.
    const msgs = missingRequirements({
      voucherType: type,
      documentRef,
      expenseSide: type === "purchase",
      costCentresEnabled: false, // not enforced: the forms do not capture cost centres per line yet
    });
    for (const message of msgs) {
      issues.push({
        kind: "reference",
        message,
        voucher_id: v.id,
        voucher_number: v.voucher_number,
        voucher_date: v.voucher_date,
      });
    }
  }

  const ledgers = (await readLedgers(companyId)) as { id: string; name: string; type: string }[];
  for (const m of ledgerTypeMismatches(ledgers)) {
    issues.push({
      kind: "ledger_type",
      message: `${m.rule}. Accepted types: ${m.accepted.join(", ")}. Current type: ${m.type}.`,
      ledger: m.name,
    });
  }

  return {
    advisory: true,
    note: "Advisory only. The save and report screens enforce these rules; this list points to the rows to fix.",
    issues: issues.slice(0, MAX_ROWS),
    total: issues.length,
  };
}
