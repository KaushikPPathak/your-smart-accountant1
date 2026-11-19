// Which vouchers belong in the Journal Book.
//
// Accounting rule used by the app (and by Tally):
//   - Cash and bank movements are recorded in Receipt, Payment or Contra vouchers
//     and appear in the Cash Book / Bank Book.
//   - A Journal voucher is for non-cash, non-bank adjustments: year-end closing,
//     depreciation, provisions, reclassifications, discounts allowed or received,
//     and any other entry where two or more ledgers are involved but no cash or
//     bank ledger is.
// So the Journal Book shows journal-type vouchers only, and drops any voucher that
// has a cash or bank ledger on either side. Whole vouchers are dropped (not single
// lines), so every voucher still shows balanced Dr = Cr in the book.
import { isJournalType } from "@/lib/journal-book-types";

export function isCashOrBankLedgerType(type: string | null | undefined): boolean {
  return type === "cash" || type === "bank";
}

interface EntryLike {
  ledger_id?: unknown;
  voucher_id?: unknown;
  vouchers?: { id?: unknown } | null;
}

/** Ids of vouchers that touch at least one cash or bank ledger. */
export function cashBankVoucherIds(
  entries: EntryLike[],
  ledgerTypeById: Map<string, string | null | undefined>,
): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    const ledgerType = ledgerTypeById.get(String(e.ledger_id ?? ""));
    if (!isCashOrBankLedgerType(ledgerType)) continue;
    const voucherId = String(e.vouchers?.id ?? e.voucher_id ?? "");
    if (voucherId) ids.add(voucherId);
  }
  return ids;
}

/** A voucher is in the Journal Book when it is a journal (or legacy untyped) and has no cash or bank ledger. */
export function isJournalBookVoucher(
  voucherType: string | null | undefined,
  voucherId: string,
  cashBankIds: Set<string>,
): boolean {
  return isJournalType(voucherType) && !cashBankIds.has(voucherId);
}
