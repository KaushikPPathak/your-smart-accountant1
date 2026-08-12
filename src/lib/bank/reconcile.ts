// Phase E2 — Reconciliation maths (local-only, no network).
//
// Produces a classic BRS view for one bank ledger:
//   Book balance (as per our vouchers, up to `asOn`)
//   +/- unreconciled statement lines (present in the bank, not matched in books)
//   = Expected statement balance, compared against the last imported
//     statement running balance when the bank file carried one.
import { readVoucherEntriesForCompany, readVouchers } from "@/lib/offline/cache-read";
import type { LocalBankLine } from "./local-store";

export interface ReconSummary {
  /** Ledger balance from our own books (paise, positive = debit / money in hand). */
  bookBalancePaise: number;
  /** Sum of unreconciled money-in lines seen in the bank but not in books. */
  unreconciledCreditPaise: number;
  /** Sum of unreconciled money-out lines seen in the bank but not in books. */
  unreconciledDebitPaise: number;
  /** bookBalance + credits - debits. */
  expectedStatementPaise: number;
  /** Closing running balance from the statement file, if it carried one. */
  statementBalancePaise: number | null;
  /** expectedStatement - statementBalance. Zero = fully reconciled. */
  differencePaise: number | null;
  asOn: string;
  counts: { matched: number; suggested: number; unmatched: number; ignored: number };
}

export async function computeBookBalance(
  companyId: string,
  ledgerId: string,
  asOn?: string,
): Promise<number> {
  const [entries, vouchers] = await Promise.all([
    readVoucherEntriesForCompany(companyId),
    readVouchers(companyId),
  ]);
  const dateById = new Map<string, string>();
  for (const v of vouchers as any[]) dateById.set(String(v.id), String(v.voucher_date || ""));
  let bal = 0;
  for (const e of entries as any[]) {
    if (String(e.ledger_id) !== ledgerId) continue;
    const d = dateById.get(String(e.voucher_id));
    if (asOn && d && d > asOn) continue;
    bal += Number(e.debit_paise ?? 0) - Number(e.credit_paise ?? 0);
  }
  return bal;
}

export function summariseLines(lines: LocalBankLine[]) {
  const counts = { matched: 0, suggested: 0, unmatched: 0, ignored: 0 };
  let unreconciledCreditPaise = 0;
  let unreconciledDebitPaise = 0;
  let asOn = "";
  let statementBalancePaise: number | null = null;
  let latestKey = "";
  for (const l of lines) {
    counts[l.match_status] = (counts[l.match_status] || 0) + 1;
    if (l.txn_date > asOn) asOn = l.txn_date;
    const key = `${l.txn_date}`;
    if (l.balance_paise != null && key >= latestKey) {
      latestKey = key;
      statementBalancePaise = l.balance_paise;
    }
    if (l.match_status === "matched" || l.match_status === "ignored") continue;
    unreconciledCreditPaise += Number(l.credit_paise || 0);
    unreconciledDebitPaise += Number(l.debit_paise || 0);
  }
  return { counts, unreconciledCreditPaise, unreconciledDebitPaise, asOn, statementBalancePaise };
}

export async function buildReconSummary(
  companyId: string,
  bankLedgerId: string,
  lines: LocalBankLine[],
): Promise<ReconSummary> {
  const s = summariseLines(lines);
  const bookBalancePaise = await computeBookBalance(companyId, bankLedgerId, s.asOn || undefined);
  const expectedStatementPaise =
    bookBalancePaise + s.unreconciledCreditPaise - s.unreconciledDebitPaise;
  return {
    bookBalancePaise,
    unreconciledCreditPaise: s.unreconciledCreditPaise,
    unreconciledDebitPaise: s.unreconciledDebitPaise,
    expectedStatementPaise,
    statementBalancePaise: s.statementBalancePaise,
    differencePaise:
      s.statementBalancePaise == null ? null : expectedStatementPaise - s.statementBalancePaise,
    asOn: s.asOn,
    counts: s.counts,
  };
}
