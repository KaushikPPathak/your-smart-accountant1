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
import { forEachEntry, forEachVoucher } from "@/lib/offline/cache-read-paged";
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
  // Score each ledger against the JOINED hint phrase (so "Jasudben A Shah"
  // is matched as one entity, not three loose words that all pick "Shah").
  const phrase = hints.join(" ").trim();
  const nPhrase = normalizeName(phrase);
  const phraseTokens = nPhrase.split(/\s+/).filter((t) => t.length >= 3);
  let best: any = null;
  let bestScore = 0;
  for (const l of all) {
    const name = String(l.name ?? "");
    const nName = normalizeName(name);
    const sim = similarity(name, phrase);
    // Token-overlap ratio: how many significant hint tokens appear in the name.
    const overlap = phraseTokens.length
      ? phraseTokens.filter((t) => nName.includes(t)).length / phraseTokens.length
      : 0;
    const contains = nName.includes(nPhrase) || nPhrase.includes(nName) ? 0.95 : 0;
    const s = Math.max(sim, contains, overlap >= 0.6 ? 0.6 + overlap * 0.3 : 0);
    if (s > bestScore) { bestScore = s; best = l; }
  }
  // Raised from 0.55 → 0.72 to avoid confidently returning the wrong ledger.
  return bestScore >= 0.72 ? best : null;
}

/** Resolve "in the books of <Company>" phrasing → companyId. */
async function resolveCompanyFromHints(hints: string[], currentId: string): Promise<string> {
  if (hints.length === 0) return currentId;
  const companies = (await readCompanies()) as any[];
  if (companies.length <= 1) return currentId;
  const phrase = hints.join(" ").trim();
  const nPhrase = normalizeName(phrase);
  let best: any = null;
  let bestScore = 0;
  for (const c of companies) {
    const nName = normalizeName(String(c.name ?? ""));
    const sim = similarity(String(c.name ?? ""), phrase);
    const contains = nName.includes(nPhrase) || nPhrase.includes(nName) ? 0.95 : 0;
    const s = Math.max(sim, contains);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= 0.78 ? String(best.id) : currentId;
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
  let target = fuzzyPickLedger(ledgers, routed.entityHints);
  // Fallback: semantic index (typos, transliteration, word order).
  if (!target && routed.entityHints.length > 0) {
    const { semanticSearch } = await import("./semantic-index");
    const hits = await semanticSearch(companyId, routed.entityHints.join(" "), { k: 3, kinds: ["party", "ledger"] });
    const top = hits[0];
    if (top) target = ledgers.find((l) => String(l.id) === top.id) ?? null;
  }
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
  const [allEntries, items] = await Promise.all([
    readVoucherEntriesForCompany(companyId),
    readVoucherItems(String(match.id)),
  ]);
  const entries = (allEntries as any[]).filter((e) => String(e.voucher_id) === String(match.id));
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

// ---------- Phase 2: dedicated retrievers ----------------------------------

const DIRECT_INCOME_HINTS = /(sales|direct income|export)/i;
const DIRECT_EXPENSE_HINTS = /(purchase|direct expense|freight inward|wages|carriage inward|manufacturing)/i;
const INDIRECT_INCOME_HINTS = /(indirect income|interest received|discount received|commission received|other income)/i;
const INDIRECT_EXPENSE_HINTS = /(indirect expense|salary|rent|electricity|office|admin|bank charges|discount allowed|depreciation)/i;
const CASH_HINTS = /(^cash|petty cash|cash in hand)/i;
const BANK_HINTS = /(bank|hdfc|icici|sbi|axis|kotak|yes bank|current a\/c|saving)/i;
const STOCK_HINTS = /(stock-in-hand|stock in hand|inventory)/i;

type LedgerKind = "direct_income"|"direct_expense"|"indirect_income"|"indirect_expense"|"cash"|"bank"|"stock"|"other";
function classifyLedger(l: any): LedgerKind {
  const g = String(l.group_name ?? "");
  const n = String(l.name ?? "");
  if (CASH_HINTS.test(n) || /cash/i.test(g)) return "cash";
  if (BANK_HINTS.test(n) || /bank/i.test(g)) return "bank";
  if (STOCK_HINTS.test(g) || STOCK_HINTS.test(n)) return "stock";
  if (DIRECT_INCOME_HINTS.test(g)) return "direct_income";
  if (DIRECT_EXPENSE_HINTS.test(g)) return "direct_expense";
  if (INDIRECT_INCOME_HINTS.test(g) || /income/i.test(g)) return "indirect_income";
  if (INDIRECT_EXPENSE_HINTS.test(g) || /expense/i.test(g)) return "indirect_expense";
  return "other";
}

/** Trial balance — all ledgers with net balance (streamed, O(1) memory). */
async function retrieveTrialBalance(companyId: string): Promise<RetrievedSlice> {
  const ledgers = (await readLedgers(companyId)) as any[];
  const acc = new Map<string, { debit_paise: number; credit_paise: number }>();
  await forEachEntry(companyId, (e) => {
    const key = String(e.ledger_id);
    const cur = acc.get(key) ?? { debit_paise: 0, credit_paise: 0 };
    cur.debit_paise += Number(e.debit_paise ?? 0);
    cur.credit_paise += Number(e.credit_paise ?? 0);
    acc.set(key, cur);
  });
  const rows = ledgers.map((l) => {
    const bal = acc.get(String(l.id)) ?? { debit_paise: 0, credit_paise: 0 };
    const opening = Number(l.opening_balance_paise ?? 0) * (l.opening_balance_is_debit ? 1 : -1);
    const net = opening + bal.debit_paise - bal.credit_paise;
    return {
      ledger_id: l.id, name: l.name, group: l.group_name,
      opening_paise: opening, debit_paise: bal.debit_paise,
      credit_paise: bal.credit_paise, closing_paise: net,
    };
  }).filter((r) => r.opening_paise !== 0 || r.debit_paise !== 0 || r.credit_paise !== 0);
  const totalDr = rows.reduce((s, r) => s + Math.max(0, r.closing_paise), 0);
  const totalCr = rows.reduce((s, r) => s + Math.max(0, -r.closing_paise), 0);
  return {
    scope: `trial balance (${rows.length} active ledgers)`,
    data: { trial_balance: rows.slice(0, 200) },
    facts: { total_debit_paise: totalDr, total_credit_paise: totalCr, difference_paise: totalDr - totalCr },
  };
}

/** Profit & Loss — direct vs indirect income/expense grouping. */
async function retrieveProfitLoss(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const [ledgers, entries, vouchers] = await Promise.all([
    readLedgers(companyId),
    readVoucherEntriesForCompany(companyId),
    readVouchers(companyId, { from: routed.from, to: routed.to }),
  ]);
  const inWindow = new Set((vouchers as any[]).map((v) => String(v.id)));
  const buckets: Record<string, { name: string; group: string; amount_paise: number }[]> = {
    direct_income: [], direct_expense: [], indirect_income: [], indirect_expense: [],
  };
  for (const l of ledgers as any[]) {
    const kind = classifyLedger(l);
    if (!(kind in buckets)) continue;
    let dr = 0, cr = 0;
    for (const e of entries as any[]) {
      if (String(e.ledger_id) !== String(l.id)) continue;
      if (!inWindow.has(String(e.voucher_id))) continue;
      dr += Number(e.debit_paise ?? 0);
      cr += Number(e.credit_paise ?? 0);
    }
    const amt = kind.endsWith("income") ? cr - dr : dr - cr;
    if (amt !== 0) buckets[kind].push({ name: l.name, group: l.group_name, amount_paise: amt });
  }
  const sum = (arr: any[]) => arr.reduce((s, r) => s + r.amount_paise, 0);
  const gross = sum(buckets.direct_income) - sum(buckets.direct_expense);
  const net = gross + sum(buckets.indirect_income) - sum(buckets.indirect_expense);
  return {
    scope: `P&L ${routed.from ?? "all-time"} → ${routed.to ?? "..."}`,
    data: buckets as unknown as Record<string, unknown[]>,
    facts: { gross_profit_paise: gross, net_profit_paise: net },
  };
}

/** Cash / bank book — entries touching cash or bank ledgers. */
async function retrieveCashBank(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const [ledgers, entries, vouchers] = await Promise.all([
    readLedgers(companyId),
    readVoucherEntriesForCompany(companyId),
    readVouchers(companyId, { from: routed.from, to: routed.to }),
  ]);
  const cashBank = (ledgers as any[]).filter((l) => {
    const k = classifyLedger(l);
    return k === "cash" || k === "bank";
  });
  const cbIds = new Set(cashBank.map((l) => String(l.id)));
  const inWindow = new Set((vouchers as any[]).map((v) => String(v.id)));
  const relevant = (entries as any[]).filter((e) => cbIds.has(String(e.ledger_id)) && inWindow.has(String(e.voucher_id)));
  const vById = new Map((vouchers as any[]).map((v) => [String(v.id), v]));
  const rows = relevant.slice(-100).map((e) => {
    const v = vById.get(String(e.voucher_id));
    return {
      date: v?.voucher_date, voucher_number: v?.voucher_number, voucher_type: v?.voucher_type,
      ledger_id: e.ledger_id, debit_paise: e.debit_paise, credit_paise: e.credit_paise,
    };
  });
  return {
    scope: `cash/bank book (${cashBank.length} accounts, ${rows.length} rows)`,
    data: {
      accounts: cashBank.map((l) => ({ id: l.id, name: l.name, kind: classifyLedger(l) })),
      entries: rows,
    },
    facts: { entry_count: relevant.length },
  };
}

/** GST — sales/purchase vouchers in window with taxable & total totals. */
async function retrieveGst(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const vouchers = (await readVouchers(companyId, { from: routed.from, to: routed.to })) as any[];
  const gstTypes = new Set(["sales", "purchase", "credit_note", "debit_note"]);
  const rel = vouchers.filter((v) => gstTypes.has(String(v.voucher_type)));
  let taxable = 0, total = 0;
  for (const v of rel) { total += Number(v.total_paise ?? 0); taxable += Number(v.subtotal_paise ?? v.total_paise ?? 0); }
  return {
    scope: `GST vouchers ${routed.from ?? "..."} → ${routed.to ?? "..."} (${rel.length} rows)`,
    data: {
      vouchers: rel.slice(0, 100).map((v) => ({
        id: v.id, date: v.voucher_date, voucher_number: v.voucher_number, voucher_type: v.voucher_type,
        party_ledger_id: v.party_ledger_id, subtotal_paise: v.subtotal_paise, total_paise: v.total_paise,
        place_of_supply: v.place_of_supply,
      })),
    },
    facts: { taxable_paise: taxable, total_paise: total, count: rel.length },
  };
}

/** Ageing — outstanding balance per party bucketed by voucher age (streamed). */
async function retrieveAgeing(companyId: string, routed: RoutedQuery): Promise<RetrievedSlice> {
  const ledgers = (await readLedgers(companyId)) as any[];
  const parties = ledgers.filter((l) => /debtor|creditor|sundry/i.test(String(l.group_name ?? "")));
  const partyIds = new Set(parties.map((p) => String(p.id)));
  const asOf = routed.to ? new Date(routed.to) : new Date();

  // Stream vouchers → date map, and entries → per-party accumulators in a
  // single pass each. O(parties + vouchers + entries) time, O(parties) memory.
  const vDate = new Map<string, string>();
  await forEachVoucher(companyId, {}, (v) => {
    if (v.voucher_date) vDate.set(String(v.id), String(v.voucher_date));
  });

  const acc = new Map<string, { net: number; buckets: Record<string, number> }>();
  for (const p of parties) {
    const opening = Number(p.opening_balance_paise ?? 0) * (p.opening_balance_is_debit ? 1 : -1);
    acc.set(String(p.id), { net: opening, buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } });
  }
  await forEachEntry(companyId, (e) => {
    const key = String(e.ledger_id);
    if (!partyIds.has(key)) return;
    const cur = acc.get(key)!;
    const amt = Number(e.debit_paise ?? 0) - Number(e.credit_paise ?? 0);
    cur.net += amt;
    const date = vDate.get(String(e.voucher_id));
    if (!date) return;
    const days = Math.floor((asOf.getTime() - new Date(date).getTime()) / 86400000);
    const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    cur.buckets[bucket] += amt;
  });

  const rows = parties.map((p) => {
    const a = acc.get(String(p.id))!;
    return { party_id: p.id, name: p.name, group: p.group_name, net_paise: a.net, buckets: a.buckets };
  }).filter((r) => r.net_paise !== 0);
  return {
    scope: `ageing as of ${asOf.toISOString().slice(0, 10)} (${rows.length} parties)`,
    data: { ageing: rows.slice(0, 150) },
    facts: { total_outstanding_paise: rows.reduce((s, r) => s + r.net_paise, 0) },
  };
}

/** Stock — items with opening + running quantities. */
async function retrieveStock(companyId: string): Promise<RetrievedSlice> {
  const { readItems } = await import("@/lib/offline/cache-read");
  const [items, ledgers] = await Promise.all([readItems(companyId), readLedgers(companyId)]);
  const stockLedgers = (ledgers as any[]).filter((l) => classifyLedger(l) === "stock");
  return {
    scope: `stock summary (${(items as any[]).length} items)`,
    data: {
      items: (items as any[]).slice(0, 200).map((i) => ({
        id: i.id, name: i.name, unit: i.unit, gst_rate: i.gst_rate,
        opening_qty: i.opening_stock_qty, opening_value_paise: i.opening_stock_value_paise,
      })),
      stock_ledgers: stockLedgers.map((l) => ({ id: l.id, name: l.name })),
    },
    facts: { item_count: (items as any[]).length },
  };
}

export async function retrieveForQuery(routed: RoutedQuery, companyIdIn?: string | null): Promise<RetrievedSlice> {
  const companyId = await resolveCompanyId(companyIdIn);
  if (!companyId) return { scope: "no active company", data: {} };
  switch (routed.intent) {
    case "party_balance":     return retrieveParty(companyId, routed, { withEntries: false });
    case "party_ledger":      return retrieveParty(companyId, routed, { withEntries: true });
    case "date_range_report": return retrieveDateRange(companyId, routed);
    case "voucher_lookup":    return retrieveVoucher(companyId, routed);
    case "ageing":            return retrieveAgeing(companyId, routed);
    case "gst_query":         return retrieveGst(companyId, routed);
    case "trial_balance":     return retrieveTrialBalance(companyId);
    case "profit_loss":       return retrieveProfitLoss(companyId, routed);
    case "cash_bank":         return retrieveCashBank(companyId, routed);
    case "stock_query":       return retrieveStock(companyId);
    case "general":
    default:                  return retrieveGeneral(companyId);
  }
}
