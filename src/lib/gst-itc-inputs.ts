// Shared ITC-from-books inputs for GSTR-9 and GSTR-3B: the books lines for a period, the class of
// each purchase voucher without a stored class, and the journal vouchers that posted input tax.
// Ledger classes chosen by the user are stored per company and win over the default rule.

import { getMeta, setMeta } from "@/lib/offline/db";
import { readLedgers, readVoucherEntriesWithVouchers } from "@/lib/offline/cache-read";
import {
  journalItcVouchers,
  purchaseBucketHints,
  type BooksLedger,
  type BooksLine,
  type ItcBucket,
  type JournalItc,
} from "@/lib/gst-itc-from-books";

const overrideKey = (companyId: string) => `gst_itc_ledger_class:${companyId}`;

/** Ledger id → class chosen by the user for ledgers that carry ITC in journals or purchases. */
export async function loadItcOverrides(companyId: string): Promise<Map<string, ItcBucket>> {
  try {
    const rec = await getMeta<Record<string, ItcBucket>>(overrideKey(companyId));
    return new Map(Object.entries(rec ?? {}));
  } catch {
    return new Map();
  }
}

/** Sets (or with null, clears) the class for one ledger. */
export async function saveItcOverride(companyId: string, ledgerId: string, bucket: ItcBucket | null): Promise<void> {
  const current: Record<string, ItcBucket> = Object.fromEntries(await loadItcOverrides(companyId));
  if (bucket) current[ledgerId] = bucket;
  else delete current[ledgerId];
  await setMeta(overrideKey(companyId), current);
}

export interface ItcClassInputs {
  purchaseBuckets: Map<string, ItcBucket>;
  journalItc: JournalItc[];
}

export async function readBooksLines(
  companyId: string,
  from: string,
  to: string,
): Promise<{ lines: BooksLine[]; ledgers: Map<string, BooksLedger> }> {
  const [entries, ledgerRows] = await Promise.all([
    readVoucherEntriesWithVouchers(companyId, { from, to }),
    readLedgers(companyId),
  ]);
  const ledgers = new Map<string, BooksLedger>(
    (ledgerRows as any[]).map((l) => [
      String(l.id),
      { name: String(l.name ?? ""), type: String(l.type ?? ""), group: l.group_name ?? null },
    ]),
  );
  const lines: BooksLine[] = (entries as any[])
    .filter((e) => e?.vouchers && (e.vouchers.voucher_type === "journal" || e.vouchers.voucher_type === "purchase"))
    .map((e) => ({
      voucherId: String(e.voucher_id),
      voucherType: String(e.vouchers.voucher_type),
      voucherDate: String(e.vouchers.voucher_date ?? ""),
      voucherNumber: String(e.vouchers.voucher_number ?? ""),
      ledgerId: String(e.ledger_id ?? ""),
      debitPaise: Number(e.debit_paise ?? 0),
      creditPaise: Number(e.credit_paise ?? 0),
    }));
  return { lines, ledgers };
}

export async function loadItcClassInputs(companyId: string, from: string, to: string): Promise<ItcClassInputs> {
  const [{ lines, ledgers }, overrides] = await Promise.all([
    readBooksLines(companyId, from, to),
    loadItcOverrides(companyId),
  ]);
  return {
    purchaseBuckets: purchaseBucketHints(lines, ledgers, overrides),
    journalItc: journalItcVouchers(lines, ledgers, overrides),
  };
}
