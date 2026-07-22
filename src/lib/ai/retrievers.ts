// Scoped retrievers — one per QueryIntent.
// Each returns the SMALLEST slice of the books needed to answer the question,
// so the payload sent to the cloud LLM is tight instead of "everything".

import {
  readCompanies,
  readLedgers,
  readVouchers,
  readVoucherEntriesForCompany,
  readVoucherItems,
} from "@/lib/offline/cache-read";
import { normalizeName, similarity } from "@/lib/tally-busy-import";
import type { RoutedQuery } from "./query-router";

export interface RetrievedSlice {
  /** Human-readable label for the slice — appears in the prompt. */
  scope: string;
  /** Row bundles keyed by logical name (ledgers, vouchers, entries, ...). */
  data: Record<string, unknown[]>;
  /** Extra structured facts (balances, totals) computed locally. */
  facts?: Record<string, unknown>;
}

function fuzzyPickLedger(all: any[], hints: string[]): any | null {
  if (hints.length === 0) return null;
  let best: any = null;
  let bestScore = 0;
  for (const l of all) {
    const name = String(l.name ?? "");
    for (const h of hints) {
      const s = Math.max(similarity(name, h), normalizeName(name).includes(normalizeName(h)) ? 0.9 : 0);
      if (s > bestScore) { bestScore = s; best = l; }
    }
  }
  return bestScore >= 0.55 ? best : null;
}

function sumEntriesFor(entries: any[], ledgerId: string) {
  let debit = 0, credit = 0;
  for (const e of entries) {
    if (String(e.ledger_id) !== ledgerId) continue;
    debit += Number(e.debit_paise ?? 0);
    credit += Number(e.credit_paise ?? 0);
  }
  return { debit_paise: debit, credit_paise: credit, balance_paise: debit - credit };
}

async function resolveCompanyId(companyId?: string | null): Promise<string | null> {
  if (companyId) return companyId;
  const companies = await readCompanies();
  return String((companies as any[])[0]?.id ?? "") || null;
}

/** Party balance / party ledger — fetch just that party's ledger + its entries. */
async function retrieveParty(companyId: string, routed: RoutedQuery, opts: { withEntries: boolean }): Promise<RetrievedSlice> {
  const ledgers = (await readLedgers(companyId)) as any[];
  const target = fuzzyPickLedger(ledgers, routed.entityHints);
  if (!target) {
    return {
      scope: `no party matched hints=${JSON.stringify(routed.entityHints)}`,
      data: { candidates: ledgers.slice(0, 20).map((l) => ({ id: l.id, name: l.name })) },
    };
  }
  const entries = (await readVoucherEntriesForCompany(companyId)) as any[];
  const bal = sumEntriesFor(entries, target.id);
  const partyEntries = entries.filter((e) => String(e.ledger_id) === String(target.id));
  const voucherIds = new Set(partyEntries.map((e) => String(e.voucher_id)));
  const allVouchers = (await readVouchers(companyId)) as any[];
  const vouchers = allVouchers.filter((v) => voucherIds.has(String(v.id)));
  return {
    scope: `party="${target.name}" (${vouchers.length} vouchers)`,
    data: {
      party: [{ id: target.id, name: target.name, group_name: target.group_name, gstin: target.gstin, state: target.state }],
      vouchers: opts.withEntries ? vouchers.slice(0, 50) : vouchers.slice(0, 10),
      entries: opts.withEntries ? partyEntries.slice(0, 200) : [],
    },
    facts: {
      opening_balance_paise: target.opening_balance_paise ?? 0,
      current_balance_paise: bal.balance_paise + Number(target.opening_balance_paise ?? 0) * (target.opening_balance_is_debit ? 1 : -1),
      total_debit_paise: bal.debit_paise,
      total_credit_paise: bal.credit_paise,
      voucher_count: vouchers.length,
    },
  };
}

/** Date-range register — sales/purchase/receipt/payment inside a window. */
async function retrieveDateRange(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const vouchers = (await readVouchers(companyId, { from: routed.from, to: routed.to })) as any[];
  let total = 0;
  for (const v of vouchers) total += Number(v.total_paise ?? v.total_amount ?? 0);
  return {
    scope: `vouchers ${routed.from ?? "..."} → ${routed.to ?? "..."} (${vouchers.length} rows)`,
    data: {
      vouchers: vouchers.slice(0, 100).map((v) => ({
        id: v.id, voucher_type: v.voucher_type, date: v.voucher_date,
        voucher_number: v.voucher_number, total_paise: v.total_paise, party_ledger_id: v.party_ledger_id,
      })),
    },
    facts: { total_paise: total, count: vouchers.length },
  };
}

/** Voucher lookup — one voucher + its entries + items. */
async function retrieveVoucher(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const vouchers = (await readVouchers(companyId)) as any[];
  const needle = routed.voucherNumber?.toLowerCase() ?? "";
  const match = vouchers.find((v) => String(v.voucher_number ?? "").toLowerCase() === needle)
             ?? vouchers.find((v) => String(v.voucher_number ?? "").toLowerCase().includes(needle));
  if (!match) {
    return { scope: `voucher not found: ${routed.voucherNumber}`, data: {} };
  }
  const [entries, items] = await Promise.all([
    (await readVoucherEntriesForCompany(companyId)).then((all: any[]) => all.filter((e) => String(e.voucher_id) === String(match.id))),
    readVoucherItems(String(match.id)),
  ]);
  return {
    scope: `voucher ${match.voucher_number} (${match.voucher_type})`,
    data: { voucher: [match], entries, items },
  };
}

/** Compact snapshot for questions we couldn't classify. */
async function retrieveGeneral(companyId: string): Promise<RetrievedSlice> {
  const [companies, ledgers, vouchers] = await Promise.all([
    readCompanies(),
    readLedgers(companyId),
    readVouchers(companyId),
  ]);
  return {
    scope: "general snapshot (top rows only)",
    data: {
      companies: (companies as any[]).map((c) => ({ id: c.id, name: c.name })),
      ledgers: (ledgers as any[]).slice(0, 50).map((l) => ({ id: l.id, name: l.name, group_name: l.group_name })),
      recentVouchers: (vouchers as any[]).slice(0, 20).map((v) => ({
        id: v.id, voucher_type: v.voucher_type, date: v.voucher_date, total_paise: v.total_paise,
      })),
    },
    facts: {
      ledger_count: (ledgers as any[]).length,
      voucher_count: (vouchers as any[]).length,
    },
  };
}

export async function retrieveForQuery(routed: RoutedQuery, companyIdIn?: string | null): Promise<RetrievedSlice> {
  const companyId = await resolveCompanyId(companyIdIn);
  if (!companyId) {
    return { scope: "no active company", data: {} };
  }
  switch (routed.intent) {
    case "party_balance":  return retrieveParty(companyId, routed, { withEntries: false });
    case "party_ledger":   return retrieveParty(companyId, routed, { withEntries: true });
    case "date_range_report": return retrieveDateRange(companyId, routed);
    case "voucher_lookup": return retrieveVoucher(companyId, routed);
    // TODO Phase 2: dedicated ageing / gst / trial-balance retrievers.
    // For now, fall through to a general snapshot so the model still has context.
    case "ageing":
    case "gst_query":
    case "trial_balance":
    case "profit_loss":
    case "cash_bank":
    case "stock_query":
    case "general":
    default:
      return retrieveGeneral(companyId);
  }
}
