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
import { scoreNameMatch, stripHonorifics } from "./phonetic";
import type { RouteResult } from "./query-router";

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
  const strippedPhrase = stripHonorifics(phrase);
  const phraseTokens = nPhrase.split(/\s+/).filter((t) => t.length >= 3);
  let best: any = null;
  let bestScore = 0;
  let bestF1 = 0;
  for (const l of all) {
    const name = String(l.name ?? "");
    const nName = normalizeName(name);
    // Base: existing edit-distance + token similarity on normalised strings.
    const sim = similarity(name, phrase);
    const overlap = phraseTokens.length
      ? phraseTokens.filter((t) => nName.includes(t)).length / phraseTokens.length
      : 0;
    const contains = nName.includes(nPhrase) || nPhrase.includes(nName) ? 0.95 : 0;
    // Phonetic + honorific-stripped scoring — the new signal for Tier 2.
    // Lets "M Shah" match "Madhuben Shah" and "Smt Madhuben H Shah" match
    // "Madhuben Shah" even when edit distance is large.
    const phon = scoreNameMatch(name, phrase).score;
    // Extra credit when the stripped phrase is contained in the stripped name
    // (handles honorific-prefix cases like "Shri Ramesh" vs "Ramesh Traders").
    const strippedName = stripHonorifics(name);
    const strippedContains =
      strippedName && strippedPhrase &&
      (strippedName.includes(strippedPhrase) || strippedPhrase.includes(strippedName))
        ? 0.9 : 0;
    const s = Math.max(sim, contains, phon, strippedContains, overlap >= 0.6 ? 0.6 + overlap * 0.3 : 0);
    if (s > bestScore) { bestScore = s; best = l; bestF1 = tokenF1(nName, nPhrase); }
    else if (best && Math.abs(s - bestScore) <= 0.02) {
      // Tie-break: prefer the candidate whose own name is best covered by the
      // query too, so "Hasmukhbhai Shah" picks "Hasmukhbhai A Shah" and not a
      // longer name that merely contains those tokens.
      const f1 = tokenF1(nName, nPhrase);
      if (f1 > bestF1) { bestScore = Math.max(bestScore, s); best = l; bestF1 = f1; }
    }
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

/**
 * Resolve a party/ledger name deterministically before fuzzy matching.
 *
 * Accounting names must be resolved as entities, not by loose similarity:
 *   - exact normalized full name wins
 *   - exact honorific-stripped full name wins
 *   - otherwise all meaningful query tokens must be present, with F1 used to
 *     prefer the shortest/best-covered ledger name
 *   - only then fall back to the existing fuzzy/phonetic resolver
 *
 * This prevents:
 *   "Hasmukhbhai Shah" -> an unrelated ledger such as an old ₹7,989 result
 * and ensures:
 *   "Miss Payal Hasmukhbhai Shah" -> the Payal ledger.
 */
function resolvePartyLedger(all: any[], hints: string[]): any | null {
  if (!hints.length) return null;

  const phrase = hints.join(" ").trim();
  const normalizedPhrase = normalizeName(phrase);
  const strippedPhrase = normalizeName(stripHonorifics(phrase));
  const queryTokens = normalizedPhrase.split(/\s+/).filter((t) => t.length >= 3);
  const strippedTokens = strippedPhrase.split(/\s+/).filter((t) => t.length >= 3);

  // Accounting identity rule:
  // Never let a generic fuzzy score decide between people with overlapping
  // names. First try a structured first-name/last-name match, allowing
  // optional middle names/initials and honorifics.
  const candidates = all.map((ledger) => {
    const rawName = String(ledger.name ?? "");
    const normalizedName = normalizeName(rawName);
    const strippedName = normalizeName(stripHonorifics(rawName));
    const nameTokens = normalizedName.split(/\s+/).filter((t) => t.length >= 3);
    const strippedNameTokens = strippedName.split(/\s+/).filter((t) => t.length >= 3);
    return { ledger, normalizedName, strippedName, nameTokens, strippedNameTokens };
  });

  // 1. Exact full name WITHOUT honorifics.
  // Only accept it immediately when it is unique. If another ledger contains
  // the same first/last identity with a middle name, the structured identity
  // rule below gets priority; this is what prevents:
  //   "Hasmukhbhai Shah" -> a short/old Hasmukhbhai Shah ledger
  // instead of:
  //   "Hasmukhbhai A Shah".
  const exactStripped = candidates.filter(
    (c) => c.strippedName === strippedPhrase,
  );

  // 2. Strong identity match for 2+ meaningful tokens:
  // first and last query tokens must be the candidate's first and last tokens.
  // Any tokens between them are allowed as middle names/initials.
  //
  // Examples:
  //   Hasmukhbhai Shah -> Hasmukhbhai A Shah
  //   Payal Shah -> Miss Payal Hasmukhbhai Shah
  //   Hasmukhbhai A Shah -> Hasmukhbhai A Shah
  //
  // This deliberately rejects:
  //   Hasmukhbhai Shah -> Payal Hasmukhbhai Shah
  // because the candidate's first token is Payal.
  if (strippedTokens.length >= 2) {
    const first = strippedTokens[0];
    const last = strippedTokens[strippedTokens.length - 1];

    const identityMatches = candidates.filter((c) => {
      const t = c.strippedNameTokens;
      if (t.length < 2) return false;
      if (t[0] !== first || t[t.length - 1] !== last) return false;

      // Every explicitly supplied query token must be present in the
      // candidate, preserving the first/last identity requirement.
      return strippedTokens.every((q) => t.includes(q));
    });

    if (identityMatches.length === 1) return identityMatches[0].ledger;

    if (identityMatches.length > 1) {
      // Prefer the candidate with the highest token F1. If still tied, prefer
      // the shortest candidate. Never fall through to fuzzy matching when
      // strong identity matches exist.
      const ranked = identityMatches
        .map((c) => ({
          ...c,
          f1: tokenF1(c.strippedName, strippedPhrase),
        }))
        .sort((a, b) => {
          if (b.f1 !== a.f1) return b.f1 - a.f1;
          return a.strippedName.length - b.strippedName.length;
        });

      const top = ranked[0];
      const second = ranked[1];
      if (!second || top.f1 > second.f1 + 0.05) return top.ledger;

      // If the user supplied a complete name, an exact stripped-name match is
      // still safe only when it is unique among the identity candidates.
      if (exactStripped.length === 1) return exactStripped[0].ledger;

      // Ambiguous identity: do not invent a financial answer.
      return null;
    }
  }

  // 3. Single-token names are intentionally conservative. If the token is
  // unique in the ledger master, use it. If several ledgers contain it, do not
  // fuzzy-pick one and risk returning another person's balance.
  if (strippedTokens.length === 1) {
    const token = strippedTokens[0];
    const exactToken = candidates.filter((c) => c.strippedNameTokens.length === 1 && c.strippedNameTokens[0] === token);
    if (exactToken.length === 1) return exactToken[0].ledger;

    const firstTokenMatches = candidates.filter((c) => c.strippedNameTokens[0] === token);
    if (firstTokenMatches.length === 1) return firstTokenMatches[0].ledger;

    // Multiple possible people/ledgers: return no match rather than a wrong
    // financial figure.
    return null;
  }

  // 4. For genuinely misspelled/incomplete multi-token names, use the existing
  // fuzzy/phonetic resolver only as a last resort. It is never allowed to
  // override a strong structured identity match above.
  return fuzzyPickLedger(all, hints);
}

/** Party balance / party ledger — fetch just that party's ledger + its entries. */
async function retrieveParty(companyId: string, routed: RouteResult, opts: { withEntries: boolean }): Promise<RetrievedSlice> {
  const ledgers = (await readLedgers(companyId)) as any[];
  let target = resolvePartyLedger(ledgers, routed.entityHints);
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
  const asOnIso = routed.asOn ?? routed.to ?? null;
  const targetId = String(target.id);
  
  // Aggregate balance incrementally using the compound index [company_id+ledger_id]
  let debit = 0, credit = 0, count = 0;
  const recentVouchers: any[] = [];
  const partyEntries: any[] = [];

  const { offlineDb } = await import("@/lib/offline/db");
  
  // 1) Pull ONLY relevant entries for this party
  const entryQuery = offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, targetId]);

  // We need voucher dates to respect asOnIso. 
  // Optimization: If asOnIso exists, we join with vouchers. 
  // If not, we just sum everything.
  
  if (asOnIso) {
    // We need to check dates. We'll pull vouchers for this party within range first.
    const vouchers = await offlineDb.cache_vouchers
      .where("[company_id+party_id+voucher_date]")
      .between([companyId, targetId, "0000-00-00"], [companyId, targetId, asOnIso], true, true)
      .reverse()
      .toArray();
    
    // Date filter must cover EVERY voucher touching this ledger (journals,
    // contras, third-party vouchers), not only those where it is the header
    // party — otherwise the balance is undercounted.
    const rows: any[] = [];
    await entryQuery.each((e: any) => rows.push(e));
    const eVoucherIds = [...new Set(rows.map((r) => String(r.voucher_id)))];
    const eVouchers = await offlineDb.cache_vouchers.bulkGet(eVoucherIds);
    const dateById = new Map<string, string>();
    eVouchers.forEach((v: any, i: number) => { if (v) dateById.set(eVoucherIds[i], String(v.voucher_date ?? "")); });
    for (const e of rows) {
      const d = dateById.get(String(e.voucher_id));
      if (!d || d > asOnIso) continue;
      debit += Number(e.debit_paise ?? 0);
      credit += Number(e.credit_paise ?? 0);
      count++;
      if (partyEntries.length < 200) partyEntries.push(e);
    }

    recentVouchers.push(...vouchers.slice(0, 8).map(v => ({
      id: String(v.id),
      number: String(v.voucher_number ?? ""),
      date: String(v.voucher_date ?? ""),
      kind: String(v.voucher_type ?? ""),
      total_paise: Number(v.total_paise ?? 0),
    })));
  } else {
    // No asOn constraint: sum all entries for this party
    await entryQuery.each((e: any) => {
      debit += Number(e.debit_paise ?? 0);
      credit += Number(e.credit_paise ?? 0);
      count++;
      if (partyEntries.length < 200) partyEntries.push(e);
    });

    const vouchers = await offlineDb.cache_vouchers
      .where("[company_id+party_id+voucher_date]")
      .between([companyId, targetId, "0000-00-00"], [companyId, targetId, "9999-99-99"], true, true)
      .reverse()
      .limit(8)
      .toArray();

    recentVouchers.push(...vouchers.map(v => ({
      id: String(v.id),
      number: String(v.voucher_number ?? ""),
      date: String(v.voucher_date ?? ""),
      kind: String(v.voucher_type ?? ""),
      total_paise: Number(v.total_paise ?? 0),
    })));
  }

  const bal = { debit_paise: debit, credit_paise: credit, balance_paise: debit - credit };

  // Optional cash-vs-bank split for the FY window ending at asOn.
  let modeSplit: { cash_paise: number; bank_paise: number; other_paise: number } | undefined;
  if (asOnIso) {
    try {
      const { fetchLedgerModeSplits } = await import("@/lib/reports");
      const d = new Date(asOnIso);
      const fyStartYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
      const from = routed.from ?? `${fyStartYear}-04-01`;
      const splits = await fetchLedgerModeSplits(companyId, from, asOnIso);
      const s = splits.get(String(target.id));
      if (s) modeSplit = { cash_paise: s.cashPaise, bank_paise: s.bankPaise, other_paise: s.otherPaise };
    } catch { /* mode split is best-effort */ }
  }

  const opening = Number(target.opening_balance_paise ?? 0) * (target.opening_balance_is_debit ? 1 : -1);
  return {
    scope: asOnIso
      ? `party="${target.name}" as on ${asOnIso} (${count} vouchers)`
      : `party="${target.name}" (${count} vouchers)`,
    data: {
      party: [{ id: target.id, name: target.name, group_name: target.group_name, gstin: target.gstin, state: target.state }],
      vouchers: [], // Vouchers are now summarized in recent_vouchers for LLM efficiency
      entries: opts.withEntries ? partyEntries.slice(0, 200) : [],
    },
    facts: {
      as_on_date: asOnIso,
      resolved_party_id: String(target.id),
      resolved_party_name: String(target.name ?? ""),
      resolved_party_group: target.group_name ?? null,
      opening_balance_paise: target.opening_balance_paise ?? 0,
      closing_balance_paise: opening + bal.balance_paise,
      current_balance_paise: opening + bal.balance_paise,
      total_debit_paise: bal.debit_paise,
      total_credit_paise: bal.credit_paise,
      voucher_count: count,
      recent_vouchers: recentVouchers,
      ...(modeSplit ? { mode_split: modeSplit } : {}),
    },
  };
}

/** Date-range register — sales/purchase/receipt/payment inside a window. */
async function retrieveDateRange(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {

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
async function retrieveVoucher(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const { offlineDb } = await import("@/lib/offline/db");
  const needle = (routed.entity?.voucherType?.toLowerCase() ?? "").trim();
  
  if (!needle) return { scope: "no voucher number specified", data: {} };

  // Try exact match on voucher_number
  let match = await offlineDb.cache_vouchers
    .where("company_id").equals(companyId)
    .filter(v => String(v.voucher_number ?? "").toLowerCase() === needle)
    .first();

  // Partial match fallback
  if (!match) {
    match = await offlineDb.cache_vouchers
      .where("company_id").equals(companyId)
      .filter(v => String(v.voucher_number ?? "").toLowerCase().includes(needle))
      .first();
  }

  if (!match) {
    return { scope: `voucher not found: ${needle}`, data: {} };
  }

  const [entries, items] = await Promise.all([
    offlineDb.cache_voucher_entries.where("voucher_id").equals(String(match.id)).toArray(),
    readVoucherItems(String(match.id)),
  ]);
  return {
    scope: `voucher ${match.voucher_number} (${match.voucher_type})`,
    data: { voucher: [match], entries, items },
  };
}

/** Latest voucher of a given kind — full detail incl. items, entries, party. */
async function retrieveLatestVoucher(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const kind = routed.entity?.voucherType ?? "sales";

  const all = (await readVouchers(companyId)) as any[];
  const filtered = all.filter((v) => String(v.voucher_type) === kind);
  if (filtered.length === 0) {
    return { scope: `no ${kind} vouchers found`, data: {} };
  }
  filtered.sort((a, b) => {
    const da = String(a.voucher_date ?? ""); const db = String(b.voucher_date ?? "");
    if (da !== db) return db.localeCompare(da);
    return String(b.voucher_number ?? "").localeCompare(String(a.voucher_number ?? ""));
  });
  const match = filtered[0];
  const [allEntries, items, ledgers] = await Promise.all([
    readVoucherEntriesForCompany(companyId),
    readVoucherItems(String(match.id)),
    readLedgers(companyId),
  ]);
  const entries = (allEntries as any[]).filter((e) => String(e.voucher_id) === String(match.id));
  const lById = new Map((ledgers as any[]).map((l) => [String(l.id), l]));
  const party = match.party_ledger_id ? lById.get(String(match.party_ledger_id)) : null;
  const enrichedEntries = entries.map((e) => ({
    ...e, ledger_name: lById.get(String(e.ledger_id))?.name,
  }));
  return {
    scope: `latest ${kind}: ${match.voucher_number} @ ${match.voucher_date}`,
    data: {
      voucher: [match],
      party: party ? [{ id: party.id, name: party.name, gstin: party.gstin, state: party.state }] : [],
      entries: enrichedEntries,
      items: (items as any[]).map((i) => ({
        item_name: i.item_name, hsn: i.hsn, qty: i.qty, unit: i.unit,
        rate_paise: i.rate_paise, amount_paise: i.amount_paise,
        gst_rate: i.gst_rate, discount_paise: i.discount_paise,
      })),
    },
    facts: {
      voucher_number: match.voucher_number, voucher_date: match.voucher_date,
      voucher_type: match.voucher_type, total_paise: match.total_paise,
      subtotal_paise: match.subtotal_paise, item_count: (items as any[]).length,
    },
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

export type LedgerKind = "direct_income"|"direct_expense"|"indirect_income"|"indirect_expense"|"cash"|"bank"|"stock"|"other";
export function classifyLedger(l: any): LedgerKind {
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
  await forEachEntry(companyId, (e: any) => {
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
async function retrieveProfitLoss(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const { offlineDb } = await import("@/lib/offline/db");
  const ledgers = (await readLedgers(companyId)) as any[];
  
  // 1) Identify vouchers in the window
  const vouchers = await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, routed.from || "0000-00-00"], [companyId, routed.to || "9999-99-99"], true, true)
    .toArray();

  const inWindow = new Set(vouchers.map((v) => String(v.id)));

  const buckets: Record<string, { name: string; group: string; amount_paise: number }[]> = {
    direct_income: [], direct_expense: [], indirect_income: [], indirect_expense: [],
  };

  // 2) Classify ledgers into P&L buckets
  const ledgerMap = new Map<string, { kind: string; name: string; group: string }>();
  for (const l of ledgers) {
    const kind = classifyLedger(l);
    if (kind in buckets) {
      ledgerMap.set(String(l.id), { kind, name: l.name, group: l.group_name });
    }
  }

  // 3) Aggregate entries for ONLY these ledgers in ONE pass
  const balances = new Map<string, { dr: number; cr: number }>();
  await offlineDb.cache_voucher_entries
    .where("company_id")
    .equals(companyId)
    .each((e: any) => {
      const lid = String(e.ledger_id);
      if (!ledgerMap.has(lid)) return;
      if (!inWindow.has(String(e.voucher_id))) return;

      const b = balances.get(lid) ?? { dr: 0, cr: 0 };
      b.dr += Number(e.debit_paise ?? 0);
      b.cr += Number(e.credit_paise ?? 0);
      balances.set(lid, b);
    });

  // 4) Fill buckets
  for (const [lid, bal] of balances.entries()) {
    const l = ledgerMap.get(lid)!;
    const amt = l.kind.endsWith("income") ? bal.cr - bal.dr : bal.dr - bal.cr;
    if (amt !== 0) {
      buckets[l.kind].push({ name: l.name, group: l.group, amount_paise: amt });
    }
  }

  const sum = (arr: any[]) => arr.reduce((s, r) => s + r.amount_paise, 0);
  const gross = sum(buckets.direct_income) - sum(buckets.direct_expense);
  const net = gross + sum(buckets.indirect_income) - sum(buckets.indirect_expense);

  let salesTotal = 0, purchaseTotal = 0, salesCount = 0, purchaseCount = 0;
  let creditNoteTotal = 0, debitNoteTotal = 0;
  for (const v of vouchers) {
    const t = String(v.voucher_type ?? "");
    const amt = Number(v.total_paise ?? 0);
    if (t === "sales") { salesTotal += amt; salesCount++; }
    else if (t === "purchase") { purchaseTotal += amt; purchaseCount++; }
    else if (t === "credit_note") { creditNoteTotal += amt; }
    else if (t === "debit_note") { debitNoteTotal += amt; }
  }
  const netSales = salesTotal - creditNoteTotal;
  const netPurchases = purchaseTotal - debitNoteTotal;

  return {
    scope: `P&L / Trading ${routed.from ?? "all-time"} → ${routed.to ?? "..."}`,
    data: buckets as unknown as Record<string, unknown[]>,
    facts: {
      gross_profit_paise: gross,
      net_profit_paise: net,
      sales_total_paise: salesTotal,
      purchase_total_paise: purchaseTotal,
      credit_notes_paise: creditNoteTotal,
      debit_notes_paise: debitNoteTotal,
      net_sales_paise: netSales,
      net_purchases_paise: netPurchases,
      sales_voucher_count: salesCount,
      purchase_voucher_count: purchaseCount,
      direct_income_total_paise: sum(buckets.direct_income),
      direct_expense_total_paise: sum(buckets.direct_expense),
      indirect_income_total_paise: sum(buckets.indirect_income),
      indirect_expense_total_paise: sum(buckets.indirect_expense),
    },
  };
}

/** Cash / bank book — entries touching cash or bank ledgers. */
// ── Direct ledger balance lookup (cash / bank) ──────────────────────────────
// Deliberately does NOT go through retrieveParty()/fuzzyPickLedger(): cash and
// bank accounts are never the voucher's "party", so the party path undercounts.

const BANK_ALIASES: Record<string, string> = {
  sbi: "state bank of india",
  bob: "bank of baroda",
  pnb: "punjab national bank",
  boi: "bank of india",
  hdfc: "hdfc bank",
  icici: "icici bank",
  axis: "axis bank",
  kotak: "kotak mahindra bank",
  idbi: "idbi bank",
  bom: "bank of maharashtra",
};

function normKey(s: string): string {
  return normalizeName(String(s ?? "")).replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenF1(a: string, b: string): number {
  const at = a.split(" ").filter((t) => t.length >= 3);
  const bt = b.split(" ").filter((t) => t.length >= 3);
  if (!at.length || !bt.length) return 0;
  const hit = at.filter((t) => bt.includes(t)).length;
  const p = hit / at.length;
  const r = hit / bt.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** Resolve a cash/bank account name to a real ledger — exact first, fuzzy last. */
export function resolveAccountLedger(ledgers: any[], account: string): any | null {
  const raw = String(account ?? "cash").trim();
  const q0 = normKey(raw);
  const q = BANK_ALIASES[q0] ?? q0;
  const cash = ledgers.filter((l) => classifyLedger(l) === "cash");
  const banks = ledgers.filter((l) => classifyLedger(l) === "bank");

  if (!q || /^(cash|cash in hand|cash on hand|cash balance|hand)$/.test(q)) {
    if (!cash.length) return null;
    return cash.find((l) => normKey(l.name) === "cash in hand")
      ?? cash.find((l) => normKey(l.name) === "cash")
      ?? cash[0];
  }
  if (/^bank( account| balance)?$/.test(q)) {
    return banks.length === 1 ? banks[0] : null;
  }

  const pool = [...banks, ...cash];
  const exact = pool.find((l) => normKey(l.name) === q);
  if (exact) return exact;
  const contains = pool.filter((l) => {
    const n = normKey(l.name);
    return n.includes(q) || q.includes(n);
  });
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) {
    return contains.reduce((a, b) => (tokenF1(normKey(b.name), q) > tokenF1(normKey(a.name), q) ? b : a));
  }
  let best: any = null;
  let bestScore = 0;
  for (const l of pool) {
    const s = Math.max(tokenF1(normKey(l.name), q), scoreNameMatch(String(l.name ?? ""), raw).score);
    if (s > bestScore) { bestScore = s; best = l; }
  }
  return bestScore >= 0.75 ? best : null;
}

/** Sum a single ledger's entries using the [company_id+ledger_id] index only. */
async function sumLedgerEntries(companyId: string, ledgerId: string, asOnIso?: string | null) {
  const { offlineDb } = await import("@/lib/offline/db");
  const query = offlineDb.cache_voucher_entries.where("[company_id+ledger_id]").equals([companyId, ledgerId]);
  let debit = 0, credit = 0, count = 0;
  if (!asOnIso) {
    await query.each((e: any) => {
      debit += Number(e.debit_paise ?? 0);
      credit += Number(e.credit_paise ?? 0);
      count++;
    });
    return { debit_paise: debit, credit_paise: credit, count };
  }
  const rows: any[] = [];
  await query.each((e: any) => rows.push(e));
  const ids = [...new Set(rows.map((r) => String(r.voucher_id)))];
  const vouchers = await offlineDb.cache_vouchers.bulkGet(ids);
  const dateById = new Map<string, string>();
  vouchers.forEach((v: any, i: number) => { if (v) dateById.set(ids[i], String(v.voucher_date ?? "")); });
  for (const e of rows) {
    const d = dateById.get(String(e.voucher_id));
    if (!d || d > asOnIso) continue;
    debit += Number(e.debit_paise ?? 0);
    credit += Number(e.credit_paise ?? 0);
    count++;
  }
  return { debit_paise: debit, credit_paise: credit, count };
}

/** Deterministic cash / bank account balance — opening + debit − credit. */
export async function retrieveAccountBalance(
  companyIdIn: string | null | undefined,
  account: string,
  asOn?: string | null,
): Promise<RetrievedSlice> {
  const companyId = await resolveCompanyId(companyIdIn);
  if (!companyId) return { scope: "no active company", data: {} };
  const ledgers = (await readLedgers(companyId)) as any[];
  const target = resolveAccountLedger(ledgers, account);
  if (!target) {
    return {
      scope: `no cash/bank account matched "${account}"`,
      data: {
        accounts: ledgers
          .filter((l) => { const k = classifyLedger(l); return k === "cash" || k === "bank"; })
          .map((l) => ({ id: l.id, name: l.name, kind: classifyLedger(l) })),
      },
    };
  }
  const asOnIso = asOn ? String(asOn) : null;
  const sums = await sumLedgerEntries(companyId, String(target.id), asOnIso);
  const opening = Number(target.opening_balance_paise ?? 0) * (target.opening_balance_is_debit ? 1 : -1);
  const closing = opening + sums.debit_paise - sums.credit_paise;
  return {
    scope: asOnIso
      ? `account="${target.name}" as on ${asOnIso} (${sums.count} entries)`
      : `account="${target.name}" (${sums.count} entries)`,
    data: { accounts: [{ id: target.id, name: target.name, kind: classifyLedger(target) }] },
    facts: {
      as_on_date: asOnIso,
      account_id: String(target.id),
      account_name: String(target.name ?? ""),
      account_kind: classifyLedger(target),
      opening_balance_paise: opening,
      total_debit_paise: sums.debit_paise,
      total_credit_paise: sums.credit_paise,
      closing_balance_paise: closing,
      current_balance_paise: closing,
      entry_count: sums.count,
    },
  };
}

async function retrieveCashBank(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const { offlineDb } = await import("@/lib/offline/db");
  const ledgers = (await readLedgers(companyId)) as any[];
  const cashBank = ledgers.filter((l) => {
    const k = classifyLedger(l);
    return k === "cash" || k === "bank";
  });
  const cbIds = new Set(cashBank.map((l) => String(l.id)));

  // 1) Find vouchers in the window
  const vouchers = await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, routed.from || "0000-00-00"], [companyId, routed.to || "9999-99-99"], true, true)
    .toArray();
  
  const inWindow = new Set(vouchers.map(v => String(v.id)));
  const vById = new Map(vouchers.map(v => [String(v.id), v]));

  // 2) Collect entries incrementally
  const relevant: any[] = [];
  await offlineDb.cache_voucher_entries
    .where("company_id")
    .equals(companyId)
    .each((e: any) => {
      if (cbIds.has(String(e.ledger_id)) && inWindow.has(String(e.voucher_id))) {
        relevant.push(e);
      }
    });

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
async function retrieveGst(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const { offlineDb } = await import("@/lib/offline/db");
  const vouchers = await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, routed.from || "0000-00-00"], [companyId, routed.to || "9999-99-99"], true, true)
    .toArray();

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
async function retrieveAgeing(companyId: string, routed: RouteResult): Promise<RetrievedSlice> {
  const ledgers = (await readLedgers(companyId)) as any[];
  const parties = ledgers.filter((l) => /debtor|creditor|sundry/i.test(String(l.group_name ?? "")));
  const partyIds = new Set(parties.map((p) => String(p.id)));
  const asOf = routed.to ? new Date(routed.to) : new Date();

  // Stream vouchers → date map, and entries → per-party accumulators in a
  // single pass each. O(parties + vouchers + entries) time, O(parties) memory.
  const vDate = new Map<string, string>();
  await forEachVoucher(companyId, (v: any) => {
    if (v.voucher_date) vDate.set(String(v.id), String(v.voucher_date));
  });

  const acc = new Map<string, { net: number; buckets: Record<string, number> }>();
  for (const p of parties) {
    const opening = Number(p.opening_balance_paise ?? 0) * (p.opening_balance_is_debit ? 1 : -1);
    acc.set(String(p.id), { net: opening, buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } });
  }
  await forEachEntry(companyId, (e: any) => {
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

export async function retrieveForQuery(routed: RouteResult, companyIdIn?: string | null): Promise<RetrievedSlice> {

  let companyId = await resolveCompanyId(companyIdIn);
  if (!companyId) return { scope: "no active company", data: {} };
  // Cross-company: "in the books of X" switches the retrieval context.
  if (routed.companyHint) {
    const resolved = await resolveCompanyFromHints([routed.companyHint], companyId);
    if (resolved && resolved !== companyId) companyId = resolved;
  } else if (routed.entityHints.length > 0) {
    // Fallback: if the user typed a company name inline (e.g. "cash on hand
    // from AVNI JENISH SHAH balance sheet"), promote it to a company switch
    // when it matches a real company much better than any ledger would.
    try {
      const companies = (await readCompanies()) as any[];
      if (companies.length > 1) {
        const phrase = routed.entityHints.join(" ").trim();
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
        if (best && bestScore >= 0.85 && String(best.id) !== String(companyId)) {
          companyId = String(best.id);
        }
      }
    } catch { /* ignore */ }
  }
  let slice: RetrievedSlice;
  switch (routed.intent) {
    case "party_balance":     slice = await retrieveParty(companyId, routed, { withEntries: true }); break;
    case "party_ledger":      slice = await retrieveParty(companyId, routed, { withEntries: true }); break;
    case "voucher_lookup":    slice = await retrieveVoucher(companyId, routed); break;
    case "trial_balance":     slice = await retrieveTrialBalance(companyId); break;
    case "explanation":       slice = await retrieveTrialBalance(companyId); break;
    case "cash_balance":      slice = await retrieveCashBank(companyId, routed); break;
    case "bank_balance":      slice = await retrieveCashBank(companyId, routed); break;
    case "ageing":            slice = await retrieveAgeing(companyId, routed); break;
    case "gst_query":         slice = await retrieveGst(companyId, routed); break;
    case "profit_loss":       slice = await retrieveProfitLoss(companyId, routed); break;
    case "stock_query":       slice = await retrieveStock(companyId); break;
    case "date_range_report": slice = await retrieveDateRange(companyId, routed); break;
    case "comparison":        slice = await retrieveDateRange(companyId, routed); break;
    default:                  slice = await retrieveGeneral(companyId); break;
  }

  // Stamp company identity into facts so the LLM can enforce "right company" rule.
  try {
    const companies = (await readCompanies()) as any[];
    const co = companies.find((c) => String(c.id) === String(companyId));
    slice.facts = { ...(slice.facts ?? {}), company_id: companyId, company_name: co?.name ?? null };
  } catch { /* ignore */ }
  return slice;
}
