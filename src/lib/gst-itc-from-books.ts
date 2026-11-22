// ITC found in the books rather than on the purchase header: input-tax debits posted in Journal
// vouchers, and a class for purchase vouchers that have none stored.
//
// Class rule, from the ledger the ITC was posted against:
//   fixed asset ledger                         → capital goods
//   expense ledger outside Purchase accounts   → expenses (input services)
//   anything else (supplier, Purchase A/c)     → goods (inputs)
// A class stored on the voucher always wins over this rule.

/** "ineligible" is ITC the user has removed from the claim (blocked credit), reported under 4D. */
export type ItcBucket = "inputs" | "inputServices" | "capitalGoods" | "ineligible";

export interface BooksLedger {
  name: string;
  type: string;
  group: string | null;
}

/** One voucher line: ledger id and the debit or credit amount in paise. */
export interface BooksLine {
  voucherId: string;
  voucherType: string;
  voucherDate: string;
  voucherNumber: string;
  ledgerId: string;
  debitPaise: number;
  creditPaise: number;
}

export interface JournalItc {
  voucherId: string;
  voucherDate: string;
  voucherNumber: string;
  bucket: ItcBucket;
  /** Ledger the ITC was posted against (the main debit that is not tax). */
  againstLedger: string;
  againstLedgerId: string;
  taxablePaise: number;
  igstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

const PARTY_TYPES = new Set(["sundry_creditor", "sundry_debtor"]);
const EXPENSE_TYPES = new Set(["expense_direct", "expense_indirect"]);

/** "INPUT CGST @ 9%" → cgst. Output and round-off ledgers are never ITC. */
export function inputTaxKindOf(name: string): "igst" | "cgst" | "sgst" | null {
  const n = name.toLowerCase();
  if (/\boutput\b|round/.test(n)) return null;
  if (!/\binput\b/.test(n)) return null;
  if (/\bigst\b/.test(n)) return "igst";
  if (/\bcgst\b/.test(n)) return "cgst";
  if (/\bsgst\b|\butgst\b/.test(n)) return "sgst";
  return null;
}

export function bucketOfLedger(ledger: BooksLedger | undefined): ItcBucket {
  if (!ledger) return "inputs";
  if (ledger.type === "fixed_asset") return "capitalGoods";
  if (EXPENSE_TYPES.has(ledger.type) && !/purchase/i.test(ledger.group ?? "")) return "inputServices";
  return "inputs";
}

/** Journal vouchers that post input tax, one result per voucher. */
export function journalItcVouchers(
  lines: BooksLine[],
  ledgers: Map<string, BooksLedger>,
  overrides: Map<string, ItcBucket> = new Map(),
): JournalItc[] {
  const byVoucher = new Map<string, BooksLine[]>();
  for (const l of lines) {
    if (l.voucherType !== "journal") continue;
    const list = byVoucher.get(l.voucherId) ?? [];
    list.push(l);
    byVoucher.set(l.voucherId, list);
  }
  const out: JournalItc[] = [];
  for (const [voucherId, vls] of byVoucher) {
    let igst = 0; let cgst = 0; let sgst = 0;
    let best: { ledgerId: string; amount: number } | null = null;
    let taxable = 0;
    for (const l of vls) {
      const led = ledgers.get(l.ledgerId);
      const name = led?.name ?? "";
      const kind = inputTaxKindOf(name);
      const net = l.debitPaise - l.creditPaise;
      if (kind) {
        if (kind === "igst") igst += net;
        else if (kind === "cgst") cgst += net;
        else sgst += net;
        continue;
      }
      if (/round|\boutput\b/i.test(name) || !led) continue;
      if (l.debitPaise > 0) {
        taxable += l.debitPaise;
        if (!best || l.debitPaise > best.amount) best = { ledgerId: l.ledgerId, amount: l.debitPaise };
      }
    }
    if (igst + cgst + sgst === 0 || !best) continue;
    const first = vls[0];
    const against = ledgers.get(best.ledgerId);
    out.push({
      voucherId,
      voucherDate: first.voucherDate,
      voucherNumber: first.voucherNumber,
      bucket: overrides.get(best.ledgerId) ?? bucketOfLedger(against),
      againstLedger: against?.name ?? "",
      againstLedgerId: best.ledgerId,
      taxablePaise: taxable,
      igstPaise: igst,
      cgstPaise: cgst,
      sgstPaise: sgst,
    });
  }
  return out.sort((a, b) => (a.voucherDate < b.voucherDate ? -1 : a.voucherDate > b.voucherDate ? 1 : a.voucherNumber.localeCompare(b.voucherNumber)));
}

/** Class of each purchase voucher from its main purchase-side credit (party and tax ledgers excluded). */
export function purchaseBucketHints(
  lines: BooksLine[],
  ledgers: Map<string, BooksLedger>,
  overrides: Map<string, ItcBucket> = new Map(),
): Map<string, ItcBucket> {
  const best = new Map<string, { ledgerId: string; amount: number }>();
  for (const l of lines) {
    if (l.voucherType !== "purchase" || l.creditPaise <= 0) continue;
    const led = ledgers.get(l.ledgerId);
    if (!led || inputTaxKindOf(led.name) || /round/i.test(led.name) || PARTY_TYPES.has(led.type) || led.type === "duties_taxes") continue;
    const cur = best.get(l.voucherId);
    if (!cur || l.creditPaise > cur.amount) best.set(l.voucherId, { ledgerId: l.ledgerId, amount: l.creditPaise });
  }
  const out = new Map<string, ItcBucket>();
  for (const [voucherId, b] of best) out.set(voucherId, overrides.get(b.ledgerId) ?? bucketOfLedger(ledgers.get(b.ledgerId)));
  return out;
}
