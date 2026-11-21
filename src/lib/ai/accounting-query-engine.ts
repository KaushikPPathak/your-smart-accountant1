import { ageOutstanding, bucketFor, daysBetween, type AgedOutstanding, type AgingBucket, type AgingSide, type DatedEntry } from "./aging";
import { settleParty, type PartyPosting, type RecordedAllocation } from "./settlement";
import { coerceDateArg, normalizeStoredDate } from "./ai-validation";
import { resolveBankAlias } from "./bank-aliases";
// src/lib/ai/accounting-query-engine.ts
//
// Authoritative, deterministic accounting calculator for the three supported
// balance questions: party/ledger balance, cash balance, bank balance.
//
// Rules enforced here:
//  • Ledger identity resolution is deterministic. When more than one ledger
//    matches, the engine reports "ambiguous" and NEVER guesses.
//  • The closing balance is always opening + debit − credit, computed from the
//    local books. The LLM never recomputes or reinterprets this number.
//  • An explicit as-on date freezes the calculation at that date; without one
//    the latest book state is used.
//
// This module is the single balance calculator for these three operations.

import { readCompanies, readLedgers } from "@/lib/offline/cache-read";
import { classifyLedger } from "./retrievers";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineLedger {
  id: string;
  name: string;
  group_name?: string | null;
  opening_balance_paise?: number | null;
  opening_balance_is_debit?: boolean | null;
  credit_days?: number | null;
  credit_limit_paise?: number | null;
}

export type AccountingQueryKind = "party_balance" | "cash_balance" | "bank_balance";

export interface AccountingQuery {
  kind: AccountingQueryKind;
  /** Ledger / party / bank name exactly as the user wrote it. */
  name?: string;
  /** Explicit as-on date (YYYY-MM-DD). Omit for the latest book state. */
  asOn?: string | null;
  companyId?: string | null;
}

export interface BalanceBreakdown {
  openingPaise: number;
  debitPaise: number;
  creditPaise: number;
  closingPaise: number;
  direction: "Dr" | "Cr" | "Nil";
  entryCount: number;
}

export const INVALID_DATE_MESSAGE = "Dates must be real calendar dates in YYYY-MM-DD form.";

export type AccountingQueryResult =
  | { status: "invalid_date"; message: string }
  | ({
      status: "resolved";
      ledgerId: string;
      ledgerName: string;
      ledgerGroup: string | null;
      asOn: string | null;
    } & BalanceBreakdown)
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found"; query: string }
  | { status: "no_company" };

export type LedgerResolution =
  | { status: "resolved"; ledger: EngineLedger }
  | { status: "ambiguous"; candidates: EngineLedger[] }
  | { status: "not_found" };

// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers (unit-testable, no I/O)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeName(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.,/\\()\-_:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHonorifics(value: string): string {
  return normalizeName(value)
    .replace(/\b(shri|sri|shree|smt|mr|mrs|miss|ms|m\/s)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trailing words a user adds to a balance question, never part of a name. */
const QUERY_NOISE =
  /\b(balance|closing|opening|account|a\/c|ac|ledger|amount|as|on|of|the|current|total)\b/g;

export function stripQueryNoise(value: string): string {
  return stripHonorifics(value).replace(QUERY_NOISE, " ").replace(/\s+/g, " ").trim();
}

const CASH_QUERY = /^(cash|cash in hand|cash on hand|cash in hands|petty cash|hand)$/;

/**
 * Deterministic ledger resolution.
 * exact name → honorific-insensitive exact → every query token present in the
 * ledger name. More than one candidate is ambiguous; zero is not found.
 * No fuzzy/phonetic scoring is ever used.
 */
export function resolveLedgerDeterministic(
  ledgers: EngineLedger[],
  query: string,
): LedgerResolution {
  const q = normalizeName(query);
  const qNoHonorific = stripHonorifics(query);
  const qClean = stripQueryNoise(query) || qNoHonorific;

  if (!q) return { status: "not_found" };

  const exact = ledgers.filter((l) => normalizeName(l.name) === q);
  if (exact.length === 1) return { status: "resolved", ledger: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };

  for (const probe of [qNoHonorific, qClean]) {
    if (!probe) continue;
    const hit = ledgers.filter((l) => stripHonorifics(l.name) === probe);
    if (hit.length === 1) return { status: "resolved", ledger: hit[0] };
    if (hit.length > 1) return { status: "ambiguous", candidates: hit };
  }

  const qTokens = (qClean || qNoHonorific).split(" ").filter(Boolean);
  if (!qTokens.length) return { status: "not_found" };

  // Single-word query: the word must be the FIRST meaningful token of the
  // ledger name (after honorifics). Exactly one such ledger resolves; several
  // is ambiguous; a word found only mid/end-name is never guessed.
  if (qTokens.length === 1) {
    const word = qTokens[0];
    const firstTokenHits = ledgers.filter(
      (l) => stripHonorifics(l.name).split(" ").filter(Boolean)[0] === word,
    );
    if (firstTokenHits.length === 1) return { status: "resolved", ledger: firstTokenHits[0] };
    if (firstTokenHits.length > 1) return { status: "ambiguous", candidates: firstTokenHits };
    return { status: "not_found" };
  }

  const candidates = ledgers.filter((l) => {
    const tokens = new Set(stripHonorifics(l.name).split(" ").filter(Boolean));
    return qTokens.every((t) => tokens.has(t));
  });

  if (candidates.length === 1) return { status: "resolved", ledger: candidates[0] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };

  // Last resort: tolerate a MINOR spelling difference (one edit) in at most one
  // word, and only when a longer word of the query matched the ledger exactly.
  // Anything less strict would be guessing between financial ledgers.
  const nearCandidates = ledgers.filter((l) => {
    const tokens = stripHonorifics(l.name).split(" ").filter(Boolean);
    let exactHits = 0;
    let nearHits = 0;
    for (const t of qTokens) {
      if (tokens.includes(t)) {
        exactHits++;
        continue;
      }
      if (tokens.some((lt) => isMinorTypo(t, lt))) {
        nearHits++;
        continue;
      }
      return false;
    }
    return nearHits <= 1 && exactHits >= 1;
  });

  if (nearCandidates.length === 1) return { status: "resolved", ledger: nearCandidates[0] };
  if (nearCandidates.length > 1) return { status: "ambiguous", candidates: nearCandidates };
  return { status: "not_found" };
}

/**
 * True when two words differ by at most one character edit (insert, delete or
 * substitute) — e.g. "shah" vs "sha". Deliberately narrow: no phonetics, no
 * scoring, and never applied to short words where one edit changes identity.
 */
export function isMinorTypo(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diff > 1) return false;
    }
    return diff === 1;
  }

  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/** Deterministic cash / bank resolution restricted to cash & bank ledgers. */
export function resolveCashBankLedger(
  ledgers: EngineLedger[],
  kind: "cash_balance" | "bank_balance",
  nameIn?: string | null,
): LedgerResolution {
  const cash = ledgers.filter((l) => classifyLedger(l) === "cash");
  const banks = ledgers.filter((l) => classifyLedger(l) === "bank");
  const raw = stripQueryNoise(String(nameIn ?? "")) || (kind === "cash_balance" ? "cash" : "");
  const aliased = resolveBankAlias(raw) ?? raw;

  if (kind === "cash_balance" || CASH_QUERY.test(aliased)) {
    if (!cash.length) return { status: "not_found" };
    const preferred =
      cash.find((l) => normalizeName(l.name) === "cash in hand") ??
      cash.find((l) => normalizeName(l.name) === "cash");
    if (preferred) return { status: "resolved", ledger: preferred };
    if (cash.length === 1) return { status: "resolved", ledger: cash[0] };
    return { status: "ambiguous", candidates: cash };
  }

  if (!aliased || /^bank$/.test(aliased)) {
    if (banks.length === 1) return { status: "resolved", ledger: banks[0] };
    if (banks.length > 1) return { status: "ambiguous", candidates: banks };
    return { status: "not_found" };
  }

  return resolveLedgerDeterministic([...banks, ...cash], aliased);
}

export function computeBalance(
  ledger: EngineLedger,
  totals: { debitPaise: number; creditPaise: number; entryCount: number },
): BalanceBreakdown {
  const opening =
    Number(ledger.opening_balance_paise ?? 0) *
    (ledger.opening_balance_is_debit === false ? -1 : 1);
  const closing = opening + totals.debitPaise - totals.creditPaise;
  return {
    openingPaise: opening,
    debitPaise: totals.debitPaise,
    creditPaise: totals.creditPaise,
    closingPaise: closing,
    direction: closing > 0 ? "Dr" : closing < 0 ? "Cr" : "Nil",
    entryCount: totals.entryCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Local book access
// ─────────────────────────────────────────────────────────────────────────────

async function resolveCompanyId(companyIdIn?: string | null): Promise<string | null> {
  if (companyIdIn) return String(companyIdIn);
  if (typeof window !== "undefined") {
    try {
      const id = window.localStorage?.getItem("ym_active_company_id");
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  const companies = (await readCompanies()) as Array<{ id?: unknown }>;
  return companies?.[0]?.id ? String(companies[0].id) : null;
}

/** Sum one ledger's live entries, optionally frozen at an as-on date. */
async function sumLedgerTotals(companyId: string, ledgerId: string, asOn: string | null) {
  const { offlineDb } = await import("@/lib/offline/db");
  type EntryRow = {
    voucher_id?: unknown;
    debit_paise?: unknown;
    credit_paise?: unknown;
    is_deleted?: boolean;
  };
  const rows: EntryRow[] = [];
  await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, ledgerId])
    .each((e: EntryRow) => {
      if (e?.is_deleted === true) return;
      rows.push(e);
    });

  let debitPaise = 0;
  let creditPaise = 0;
  let entryCount = 0;

  const ids = [...new Set(rows.map((r) => String(r.voucher_id)))];
  const vouchers = await offlineDb.cache_vouchers.bulkGet(ids);
  const dateById = new Map<string, string>();
  vouchers.forEach(
    (
      v: { voucher_date?: unknown; date?: unknown; is_deleted?: boolean } | undefined,
      i: number,
    ) => {
      if (v && v.is_deleted !== true) dateById.set(ids[i], normalizeStoredDate(v.voucher_date ?? v.date));
    },
  );

  for (const e of rows) {
    const date = dateById.get(String(e.voucher_id));
    if (!date) continue;
    if (asOn && date > asOn) continue;
    debitPaise += Number(e.debit_paise ?? 0);
    creditPaise += Number(e.credit_paise ?? 0);
    entryCount++;
  }

  return { debitPaise, creditPaise, entryCount };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runAccountingQuery(query: AccountingQuery): Promise<AccountingQueryResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const asOn = asOnArg.value;

  const resolution =
    query.kind === "party_balance"
      ? resolveLedgerDeterministic(ledgers, String(query.name ?? ""))
      : resolveCashBankLedger(ledgers, query.kind, query.name);

  if (resolution.status === "ambiguous") {
    return {
      status: "ambiguous",
      candidates: resolution.candidates.map((l) => String(l.name ?? "")),
    };
  }
  if (resolution.status === "not_found") {
    return { status: "not_found", query: String(query.name ?? query.kind) };
  }

  const ledger = resolution.ledger;
  const totals = await sumLedgerTotals(companyId, String(ledger.id), asOn);
  const balance = computeBalance(ledger, totals);

  return {
    status: "resolved",
    ledgerId: String(ledger.id),
    ledgerName: String(ledger.name ?? ""),
    ledgerGroup: (ledger.group_name as string | null) ?? null,
    asOn,
    ...balance,
  };
}

/** Standard, non-guessing replies for unresolved accounting lookups. */
export const AMBIGUOUS_LEDGER_MESSAGE =
  "I found more than one matching account. Please specify the full ledger name.";
export const LEDGER_NOT_FOUND_MESSAGE = "I couldn't find that ledger in the current company.";

// ─────────────────────────────────────────────────────────────────────────────
//  Trial Balance (authoritative)
//
//  Mirrors the existing Trial Balance report exactly:
//   • ledger source  : local ledger cache for the active company
//   • opening        : opening_balance_paise signed by opening_balance_is_debit
//   • movement       : sum(debit) − sum(credit) of live entries up to the date
//   • closing        : opening + movement
//   • classification : closing > 0 → Dr column, closing < 0 → Cr column
//   • date/FY        : as-on date (inclusive); defaults to the active FY end
//  No LLM involvement, no fuzzy matching, no caching.
// ─────────────────────────────────────────────────────────────────────────────

export interface TrialBalanceEntry {
  ledgerId: string;
  debitPaise: number;
  creditPaise: number;
  date: string;
}

export interface TrialBalanceRow {
  ledgerId: string;
  ledgerName: string;
  ledgerGroup: string | null;
  openingPaise: number;
  entryDebitPaise: number;
  entryCreditPaise: number;
  closingPaise: number;
  direction: "Dr" | "Cr" | "Nil";
  /** Amount shown in the Debit column (0 when the balance is a credit). */
  debitPaise: number;
  /** Amount shown in the Credit column (0 when the balance is a debit). */
  creditPaise: number;
}

export interface TrialBalanceResult {
  status: "resolved";
  asOn: string | null;
  rows: TrialBalanceRow[];
  totalDebitPaise: number;
  totalCreditPaise: number;
  balanced: boolean;
}

/** Pure Trial Balance calculation — the single authoritative implementation. */
export function computeTrialBalance(
  ledgers: EngineLedger[],
  entries: TrialBalanceEntry[],
  asOn?: string | null,
): TrialBalanceResult {
  const on = asOn ? String(asOn) : null;

  const movement = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    if (!e || !e.ledgerId) continue;
    if (on && String(e.date ?? "") > on) continue;
    const key = String(e.ledgerId);
    const acc = movement.get(key) ?? { debit: 0, credit: 0 };
    acc.debit += Number(e.debitPaise ?? 0);
    acc.credit += Number(e.creditPaise ?? 0);
    movement.set(key, acc);
  }

  const rows: TrialBalanceRow[] = ledgers.map((l) => {
    const opening =
      Number(l.opening_balance_paise ?? 0) * (l.opening_balance_is_debit === false ? -1 : 1);
    const m = movement.get(String(l.id)) ?? { debit: 0, credit: 0 };
    const closing = opening + m.debit - m.credit;
    return {
      ledgerId: String(l.id),
      ledgerName: String(l.name ?? ""),
      ledgerGroup: (l.group_name as string | null) ?? null,
      openingPaise: opening,
      entryDebitPaise: m.debit,
      entryCreditPaise: m.credit,
      closingPaise: closing,
      direction: closing > 0 ? "Dr" : closing < 0 ? "Cr" : "Nil",
      debitPaise: closing > 0 ? closing : 0,
      creditPaise: closing < 0 ? -closing : 0,
    };
  });

  const totalDebitPaise = rows.reduce((s, r) => s + r.debitPaise, 0);
  const totalCreditPaise = rows.reduce((s, r) => s + r.creditPaise, 0);

  return {
    status: "resolved",
    asOn: on,
    rows,
    totalDebitPaise,
    totalCreditPaise,
    balanced: totalDebitPaise === totalCreditPaise,
  };
}

/** Financial-year end (31 March) for a date, used when no as-on date is given. */
export function fyEndFor(date: Date = new Date()): string {
  const y = date.getFullYear();
  const endYear = date.getMonth() + 1 >= 4 ? y + 1 : y;
  return `${endYear}-03-31`;
}

/** Read every live entry of the company up to the as-on date. */
async function readTrialBalanceEntries(
  companyId: string,
  asOn: string,
): Promise<TrialBalanceEntry[]> {
  const { offlineDb } = await import("@/lib/offline/db");
  // Whole-company read with normalised dates. An index range would miss stored dates that are
  // not zero-padded (e.g. "2025-4-5"), because they sort outside an ISO range.
  const vouchers = (await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, ""], [companyId, "￿"], true, true)
    .toArray()) as Array<{ id?: unknown; voucher_date?: unknown; date?: unknown; is_deleted?: boolean }>;

  const dateById = new Map<string, string>();
  for (const v of vouchers) {
    if (v?.is_deleted === true) continue;
    const d = normalizeStoredDate(v.voucher_date ?? v.date);
    if (d && d <= asOn) dateById.set(String(v.id), d);
  }
  const ids = [...dateById.keys()];

  const out: TrialBalanceEntry[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await offlineDb.cache_voucher_entries
      .where("voucher_id")
      .anyOf(chunk)
      .toArray()) as Array<{
      voucher_id?: unknown;
      ledger_id?: unknown;
      debit_paise?: unknown;
      credit_paise?: unknown;
      is_deleted?: boolean;
    }>;
    for (const e of rows) {
      if (e?.is_deleted === true) continue;
      const date = dateById.get(String(e.voucher_id));
      if (!date) continue;
      out.push({
        ledgerId: String(e.ledger_id),
        debitPaise: Number(e.debit_paise ?? 0),
        creditPaise: Number(e.credit_paise ?? 0),
        date,
      });
    }
  }
  return out;
}

export interface TrialBalanceQuery {
  asOn?: string | null;
  companyId?: string | null;
}

export async function runTrialBalance(
  query: TrialBalanceQuery = {},
): Promise<TrialBalanceResult | { status: "no_company" } | { status: "invalid_date"; message: string }> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const asOn = asOnArg.value ?? fyEndFor();
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const entries = await readTrialBalanceEntries(companyId, asOn);
  return computeTrialBalance(ledgers, entries, asOn);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ledger Statement (authoritative)
//
//  Mirrors the existing Ledger Statement report exactly:
//   • entries        : live voucher_entries of the ledger joined to their voucher
//   • ordering       : voucher_date asc, then voucher_number compared numerically
//   • opening        : signed opening balance + movement of everything BEFORE
//                      the period start (same as the report's "openingBeforeFrom")
//   • running balance: opening + Σ(debit − credit) row by row
//   • totals         : debit / credit of the rows inside the period
//   • closing        : opening + totalDebit − totalCredit
//  No LLM involvement, no fuzzy matching, no caching.
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerStatementTxn {
  voucherId: string;
  date: string;
  voucherNumber: string;
  voucherType?: string | null;
  referenceNo?: string | null;
  narration?: string | null;
  debitPaise: number;
  creditPaise: number;
}

export interface LedgerStatementRow {
  voucherId: string;
  date: string;
  voucherNumber: string;
  voucherType: string | null;
  referenceNo: string | null;
  narration: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  balanceDirection: "Dr" | "Cr" | "Nil";
}

export interface LedgerStatementResult {
  status: "resolved";
  ledgerId: string;
  ledgerName: string;
  ledgerGroup: string | null;
  from: string | null;
  to: string | null;
  openingPaise: number;
  openingDirection: "Dr" | "Cr" | "Nil";
  rows: LedgerStatementRow[];
  totalDebitPaise: number;
  totalCreditPaise: number;
  closingPaise: number;
  closingDirection: "Dr" | "Cr" | "Nil";
}

export type LedgerStatementOutcome =
  | { status: "invalid_date"; message: string }
  | LedgerStatementResult
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found"; query: string }
  | { status: "no_company" };

export interface LedgerStatementQuery {
  /** Ledger name exactly as the user wrote it. */
  name: string;
  from?: string | null;
  to?: string | null;
  /** Include everything through this date (period start stays the FY start). */
  asOn?: string | null;
  companyId?: string | null;
}

function directionOf(paise: number): "Dr" | "Cr" | "Nil" {
  return paise > 0 ? "Dr" : paise < 0 ? "Cr" : "Nil";
}

/** Numeric voucher-number sort key, matching the shared voucher ordering rule. */
function vchSortKey(value: string | null | undefined): number {
  if (!value) return 0;
  const n = parseInt(String(value).replace(/\D+/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Pure Ledger Statement calculation — the single authoritative implementation. */
export function computeLedgerStatement(
  ledger: EngineLedger,
  txns: LedgerStatementTxn[],
  period: { from?: string | null; to?: string | null } = {},
): Omit<LedgerStatementResult, "ledgerId" | "ledgerName" | "ledgerGroup"> {
  const from = period.from ? String(period.from) : null;
  const to = period.to ? String(period.to) : null;

  const signedOpening =
    Number(ledger.opening_balance_paise ?? 0) *
    (ledger.opening_balance_is_debit === false ? -1 : 1);

  let openingPaise = signedOpening;
  const inPeriod: LedgerStatementTxn[] = [];

  for (const t of txns ?? []) {
    if (!t) continue;
    const date = String(t.date ?? "");
    if (!date) continue;
    if (from && date < from) {
      openingPaise += Number(t.debitPaise ?? 0) - Number(t.creditPaise ?? 0);
      continue;
    }
    if (to && date > to) continue;
    inPeriod.push(t);
  }

  inPeriod.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return vchSortKey(a.voucherNumber) - vchSortKey(b.voucherNumber);
  });

  let balance = openingPaise;
  let totalDebitPaise = 0;
  let totalCreditPaise = 0;

  const rows: LedgerStatementRow[] = inPeriod.map((t) => {
    const debitPaise = Number(t.debitPaise ?? 0);
    const creditPaise = Number(t.creditPaise ?? 0);
    balance += debitPaise - creditPaise;
    totalDebitPaise += debitPaise;
    totalCreditPaise += creditPaise;
    return {
      voucherId: String(t.voucherId ?? ""),
      date: String(t.date ?? ""),
      voucherNumber: String(t.voucherNumber ?? ""),
      voucherType: (t.voucherType as string | null) ?? null,
      referenceNo: (t.referenceNo as string | null) ?? null,
      narration:
        (t.narration && String(t.narration).trim()) ||
        (t.referenceNo && String(t.referenceNo).trim()) ||
        "",
      debitPaise,
      creditPaise,
      balancePaise: balance,
      balanceDirection: directionOf(balance),
    };
  });

  const closingPaise = openingPaise + totalDebitPaise - totalCreditPaise;

  return {
    status: "resolved",
    from,
    to,
    openingPaise,
    openingDirection: directionOf(openingPaise),
    rows,
    totalDebitPaise,
    totalCreditPaise,
    closingPaise,
    closingDirection: directionOf(closingPaise),
  };
}

/** Financial-year start (1 April) for a date, used when no period is given. */
export function fyStartFor(date: Date = new Date()): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}-04-01`;
}

/** Read every live transaction of one ledger (unfiltered; the pure fn filters). */
async function readLedgerStatementTxns(
  companyId: string,
  ledgerId: string,
): Promise<LedgerStatementTxn[]> {
  const { offlineDb } = await import("@/lib/offline/db");
  type EntryRow = {
    voucher_id?: unknown;
    debit_paise?: unknown;
    credit_paise?: unknown;
    narration?: unknown;
    is_deleted?: boolean;
  };
  const entries = (await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, ledgerId])
    .toArray()) as EntryRow[];

  const live = entries.filter((e) => e?.is_deleted !== true);
  const ids = [...new Set(live.map((e) => String(e.voucher_id)))];

  type VoucherRow = {
    id?: unknown;
    voucher_date?: unknown;
    date?: unknown;
    voucher_number?: unknown;
    voucher_type?: unknown;
    reference_no?: unknown;
    narration?: unknown;
    is_deleted?: boolean;
  };
  const byId = new Map<string, VoucherRow>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = (await offlineDb.cache_vouchers
      .where("id")
      .anyOf(ids.slice(i, i + 500))
      .toArray()) as VoucherRow[];
    for (const v of rows) {
      if (v?.is_deleted !== true) byId.set(String(v.id), v);
    }
  }

  const out: LedgerStatementTxn[] = [];
  for (const e of live) {
    const v = byId.get(String(e.voucher_id));
    if (!v) continue;
    out.push({
      voucherId: String(v.id),
      date: normalizeStoredDate(v.voucher_date ?? v.date),
      voucherNumber: String(v.voucher_number ?? ""),
      voucherType: (v.voucher_type as string | null) ?? null,
      referenceNo: (v.reference_no as string | null) ?? null,
      narration:
        (e.narration ? String(e.narration) : "") || (v.narration ? String(v.narration) : ""),
      debitPaise: Number(e.debit_paise ?? 0),
      creditPaise: Number(e.credit_paise ?? 0),
    });
  }
  return out;
}

export async function runLedgerStatement(
  query: LedgerStatementQuery,
): Promise<LedgerStatementOutcome> {
  if ([query.from, query.to, query.asOn].some((v) => !coerceDateArg(v).ok)) {
    return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  }
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const resolution = resolveLedgerDeterministic(ledgers, String(query.name ?? ""));

  if (resolution.status === "ambiguous") {
    return { status: "ambiguous", candidates: resolution.candidates.map((l) => String(l.name ?? "")) };
  }
  if (resolution.status === "not_found") {
    return { status: "not_found", query: String(query.name ?? "") };
  }

  // Date rules: explicit from/to win; an as-on date runs from the start of the
  // financial year CONTAINING that date through the date itself; otherwise the
  // current financial year. No invented dates.
  const from = query.from
    ? String(query.from)
    : query.asOn
      ? fyStartFor(new Date(`${String(query.asOn)}T00:00:00`))
      : fyStartFor();
  const to = query.to ? String(query.to) : query.asOn ? String(query.asOn) : fyEndFor();

  const ledger = resolution.ledger;
  const txns = await readLedgerStatementTxns(companyId, String(ledger.id));
  return {
    ledgerId: String(ledger.id),
    ledgerName: String(ledger.name ?? ""),
    ledgerGroup: (ledger.group_name as string | null) ?? null,
    ...computeLedgerStatement(ledger, txns, { from, to }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Receivables / payables by party, with ageing
//
//  Recorded bill allocations are applied first; FIFO covers only unallocated amounts. Advances,
//  credit notes, debit notes and other unmatched amounts are separate categories (settlement.ts).
//  Overdue uses each ledger's credit days where set; otherwise 30 days, and the row says which.
//  Read-only: nothing here writes to the books or to cache_bill_allocations.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CREDIT_DAYS = 30;

export interface PartyReconciliation {
  /** Ledger balance from every non-deleted entry, in the party's own direction. */
  ledgerBalancePaise: number;
  /** Net as on the as-on date, from the settlement. */
  netAsOnPaise: number;
  /** ledgerBalancePaise − netAsOnPaise. */
  differencePaise: number;
  /** Postings dated after the as-on date (explains part of the difference). */
  postingsAfterAsOnPaise: number;
  postingsAfterAsOnCount: number;
  /** Entries whose voucher is missing from the local cache or deleted (explains part of the difference). */
  orphanPaise: number;
  orphanCount: number;
  /** Difference not explained by the two items above. Zero when the books reconcile. */
  unexplainedPaise: number;
}

export interface PartySummaryRow {
  ledgerId: string;
  name: string;
  /** Open bills after recorded allocations and FIFO. */
  outstandingPaise: number;
  /** Open bills past their credit days. Opening balances count (their age is not recorded). */
  overduePaise: number;
  /** Receivable: unmatched receipts. Payable: unmatched payments. */
  advancePaise: number;
  /** Receivable only: unmatched credit notes. */
  customerCreditNotePaise: number;
  /** Payable only: unmatched debit notes. */
  vendorDebitNotePaise: number;
  /** Unmatched journals and other postings. */
  otherUnmatchedPaise: number;
  /** Outstanding less every unmatched amount: the balance in the party's own direction. */
  netPaise: number;
  creditDays: number;
  creditDaysSource: "ledger" | "default_30";
  allocatedPaise: number;
  fifoPaise: number;
  invalidAllocations: number;
  buckets: AgedOutstanding["buckets"];
  reconciliation: PartyReconciliation;
}

export type PartySummaryResult =
  | {
      status: "resolved";
      side: AgingSide;
      asOn: string;
      rows: PartySummaryRow[];
      totalOutstandingPaise: number;
      totalBuckets: AgedOutstanding["buckets"];
    }
  | { status: "no_company" }
  | { status: "invalid_date"; message: string };

interface LedgerPostingSet {
  postings: PartyPosting[];
  /** Every non-deleted entry, in the party's own direction, excluding the opening balance. */
  ledgerNetPaise: number;
  afterAsOnPaise: number;
  afterAsOnCount: number;
  orphanPaise: number;
  orphanCount: number;
}

async function loadLedgerPostings(companyId: string, ledgerId: string, asOn: string, owedSign: 1 | -1): Promise<LedgerPostingSet> {
  const { offlineDb } = await import("@/lib/offline/db");
  const raw: Array<{ voucher_id: unknown; debit_paise?: unknown; credit_paise?: unknown; is_deleted?: boolean }> = [];
  await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, ledgerId])
    .each((e: (typeof raw)[number]) => {
      if (e?.is_deleted === true) return;
      raw.push(e);
    });
  const ids = [...new Set(raw.map((e) => String(e.voucher_id)))];
  const vouchers = await offlineDb.cache_vouchers.bulkGet(ids);
  const live = new Map<string, { date: string; type: string }>();
  vouchers.forEach((v: { voucher_date?: unknown; date?: unknown; voucher_type?: unknown; is_deleted?: boolean } | undefined, i: number) => {
    if (v && v.is_deleted !== true) {
      live.set(ids[i], { date: normalizeStoredDate(v.voucher_date ?? v.date), type: String(v.voucher_type ?? "") });
    }
  });
  const out: LedgerPostingSet = { postings: [], ledgerNetPaise: 0, afterAsOnPaise: 0, afterAsOnCount: 0, orphanPaise: 0, orphanCount: 0 };
  for (const e of raw) {
    const debit = Number(e.debit_paise ?? 0);
    const credit = Number(e.credit_paise ?? 0);
    const owed = owedSign * (debit - credit);
    out.ledgerNetPaise += owed;
    const v = live.get(String(e.voucher_id));
    if (!v) {
      out.orphanPaise += owed;
      out.orphanCount++;
      continue;
    }
    if (v.date > asOn) {
      out.afterAsOnPaise += owed;
      out.afterAsOnCount++;
    }
    out.postings.push({ voucherId: String(e.voucher_id), date: v.date, debitPaise: debit, creditPaise: credit, voucherType: v.type });
  }
  return out;
}

/** Recorded bill allocations for the company, grouped by the ledger they belong to. Read-only. */
export async function allocationsByLedger(companyId: string): Promise<Map<string, RecordedAllocation[]>> {
  const { offlineDb } = await import("@/lib/offline/db");
  const rows = (await offlineDb.cache_bill_allocations.where("company_id").equals(companyId).toArray()) as Array<{
    invoice_voucher_id: unknown;
    payment_voucher_id: unknown;
    ledger_id: unknown;
    amount_paise?: unknown;
    is_deleted?: boolean;
  }>;
  const map = new Map<string, RecordedAllocation[]>();
  for (const r of rows) {
    if (r.is_deleted === true) continue;
    const key = String(r.ledger_id);
    const list = map.get(key) ?? [];
    list.push({
      invoiceVoucherId: String(r.invoice_voucher_id),
      paymentVoucherId: String(r.payment_voucher_id),
      amountPaise: Number(r.amount_paise ?? 0),
    });
    map.set(key, list);
  }
  return map;
}

/**
 * Outstanding receivables (sundry debtors) or payables (sundry creditors) for every party, largest
 * first. Figures come from the books as on the given date, never from a cached answer.
 */
export async function runPartySummary(query: {
  side: AgingSide;
  asOn?: string | null;
  companyId?: string | null;
}): Promise<PartySummaryResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value ?? new Date().toISOString().slice(0, 10);

  const wantGroup = query.side === "receivable" ? "debtor" : "creditor";
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const parties = ledgers.filter((l) => (l.group_name ?? "").toLowerCase().includes(wantGroup));
  const allocs = await allocationsByLedger(companyId);
  // Receivables are owed in the debit direction; payables in the credit direction.
  const owedSign: 1 | -1 = query.side === "receivable" ? 1 : -1;

  const rows: PartySummaryRow[] = [];
  for (const ledger of parties) {
    const ledgerId = String(ledger.id);
    const signedOpening = Number(ledger.opening_balance_paise ?? 0) * (ledger.opening_balance_is_debit === false ? -1 : 1);
    const opening = owedSign * signedOpening; // positive = owed to us (receivable) or by us (payable)

    const set = await loadLedgerPostings(companyId, ledgerId, asOn, owedSign);
    const s = settleParty({
      side: query.side,
      openingPaise: opening,
      postings: set.postings,
      allocations: allocs.get(ledgerId) ?? [],
      asOn,
    });

    const cd = Number(ledger.credit_days ?? 0);
    const creditDays = cd > 0 ? cd : DEFAULT_CREDIT_DAYS;
    const buckets: AgedOutstanding["buckets"] = { opening: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    let outstanding = 0;
    let overdue = 0;
    for (const b of s.openBills) {
      outstanding += b.openPaise;
      if (b.date === null) {
        buckets.opening += b.openPaise;
        overdue += b.openPaise; // age unknown: counted as overdue, and the answer says so
        continue;
      }
      const days = daysBetween(b.date, asOn);
      buckets[bucketFor(days)] += b.openPaise;
      if (days > creditDays) overdue += b.openPaise;
    }

    const u = s.unmatched;
    const advance = query.side === "receivable" ? u.customer_advance : u.vendor_advance;
    const customerCreditNote = query.side === "receivable" ? u.customer_credit_note : 0;
    const vendorDebitNote = query.side === "payable" ? u.vendor_debit_note : 0;
    if (outstanding === 0 && advance === 0 && customerCreditNote === 0 && vendorDebitNote === 0 && u.other_unmatched === 0 && s.invalid.length === 0) {
      continue;
    }

    const ledgerBalance = opening + set.ledgerNetPaise;
    const difference = ledgerBalance - s.netPaise;
    rows.push({
      ledgerId,
      name: ledger.name,
      outstandingPaise: outstanding,
      overduePaise: overdue,
      advancePaise: advance,
      customerCreditNotePaise: customerCreditNote,
      vendorDebitNotePaise: vendorDebitNote,
      otherUnmatchedPaise: u.other_unmatched,
      netPaise: s.netPaise,
      creditDays,
      creditDaysSource: cd > 0 ? "ledger" : "default_30",
      allocatedPaise: s.allocatedPaise,
      fifoPaise: s.fifoPaise,
      invalidAllocations: s.invalid.length,
      buckets,
      reconciliation: {
        ledgerBalancePaise: ledgerBalance,
        netAsOnPaise: s.netPaise,
        differencePaise: difference,
        postingsAfterAsOnPaise: set.afterAsOnPaise,
        postingsAfterAsOnCount: set.afterAsOnCount,
        orphanPaise: set.orphanPaise,
        orphanCount: set.orphanCount,
        unexplainedPaise: difference - set.afterAsOnPaise - set.orphanPaise,
      },
    });
  }

  rows.sort((a, b) => b.outstandingPaise - a.outstandingPaise);
  const totalBuckets: AgedOutstanding["buckets"] = { opening: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  for (const r of rows) for (const k of Object.keys(totalBuckets) as AgingBucket[]) totalBuckets[k] += r.buckets[k];
  return {
    status: "resolved",
    side: query.side,
    asOn,
    rows,
    totalOutstandingPaise: rows.reduce((s, r) => s + r.outstandingPaise, 0),
    totalBuckets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Totals: all cash and bank ledgers, and sales vouchers for a period
// ─────────────────────────────────────────────────────────────────────────────

export interface CashBankRow {
  ledgerId: string;
  name: string;
  kind: "cash" | "bank";
  closingPaise: number;
}

export type CashBankTotalResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; asOn: string | null; rows: CashBankRow[]; totalPaise: number };

/** Signed sum of closing balances of every cash and bank ledger (overdrawn banks count negative). */
export async function runCashBankTotal(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<CashBankTotalResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value;

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const rows: CashBankRow[] = [];
  for (const ledger of ledgers) {
    const kind = classifyLedger(ledger);
    if (kind !== "cash" && kind !== "bank") continue;
    const totals = await sumLedgerTotals(companyId, String(ledger.id), asOn);
    const balance = computeBalance(ledger, totals);
    rows.push({
      ledgerId: String(ledger.id),
      name: String(ledger.name ?? ""),
      kind,
      closingPaise: balance.closingPaise,
    });
  }
  rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "cash" ? -1 : 1));
  const totalPaise = rows.reduce((s, r) => s + r.closingPaise, 0);
  return { status: "resolved", asOn, rows, totalPaise };
}

export type SalesTotalResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; from: string; to: string; count: number; totalPaise: number };

/**
 * Sum of the total on each live sales voucher dated in the period.
 * Defaults to the current financial year. Credit notes are not deducted.
 */
export async function runSalesTotal(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<SalesTotalResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const from = fromArg.value ?? fyStartFor();
  const to = toArg.value ?? fyEndFor();

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const vouchers = (await readVouchers(companyId, { voucher_type: "sales" })) as any[];
  let count = 0;
  let totalPaise = 0;
  for (const v of vouchers) {
    const date = normalizeStoredDate(v.voucher_date ?? v.date);
    if (!date || date < from || date > to) continue;
    count++;
    totalPaise += Number(v.total_paise ?? 0);
  }
  return { status: "resolved", from, to, count, totalPaise };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bank and cash outflow spikes (questionnaire 1.4)
// ─────────────────────────────────────────────────────────────────────────────

/** A month is a spike when its outflow is at least this many times the average of earlier months… */
export const SPIKE_RATIO = 2;
/** …and at least this much (paise, ₹10,000), so small accounts do not generate noise. */
export const SPIKE_MIN_PAISE = 1_000_000;

export interface BankAnomalyRow {
  ledgerName: string;
  kind: "cash" | "bank";
  month: string;
  outflowPaise: number;
  baselinePaise: number;
  baselineMonths: number;
  ratio: number;
}

export type BankAnomalyResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; asOn: string | null; checkedLedgers: number; flagged: BankAnomalyRow[] };

/** Every "YYYY-MM" from start up to, not including, end. */
function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m < em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Flags cash and bank ledgers whose latest posted month has an outflow (credits) well above
 * their earlier monthly average. Months with no postings count as zero in the average.
 */
export async function runBankAnomalies(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<BankAnomalyResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value;

  const { offlineDb } = await import("@/lib/offline/db");
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const targets = ledgers.filter((l) => {
    const k = classifyLedger(l);
    return k === "cash" || k === "bank";
  });

  const flagged: BankAnomalyRow[] = [];
  for (const ledger of targets) {
    const raw: Array<{ voucher_id: unknown; credit_paise?: unknown; is_deleted?: boolean }> = [];
    await offlineDb.cache_voucher_entries
      .where("[company_id+ledger_id]")
      .equals([companyId, String(ledger.id)])
      .each((e: (typeof raw)[number]) => {
        if (e?.is_deleted === true) return;
        raw.push(e);
      });
    const ids = [...new Set(raw.map((e) => String(e.voucher_id)))];
    const vouchers = await offlineDb.cache_vouchers.bulkGet(ids);
    const dateById = new Map<string, string>();
    vouchers.forEach((v: { voucher_date?: unknown; date?: unknown; is_deleted?: boolean } | undefined, i: number) => {
      if (v && v.is_deleted !== true) dateById.set(ids[i], normalizeStoredDate(v.voucher_date ?? v.date));
    });

    // Outflow leaves a bank or cash ledger on its credit side.
    const outByMonth = new Map<string, number>();
    for (const e of raw) {
      const date = dateById.get(String(e.voucher_id));
      if (!date || (asOn && date > asOn)) continue;
      const month = date.slice(0, 7);
      outByMonth.set(month, (outByMonth.get(month) ?? 0) + Number(e.credit_paise ?? 0));
    }
    if (outByMonth.size === 0) continue;

    const months = [...outByMonth.keys()].sort();
    const latest = months[months.length - 1];
    const earlier = monthsBetween(months[0], latest);
    if (earlier.length === 0) continue;
    const baseline = Math.round(earlier.reduce((s, m) => s + (outByMonth.get(m) ?? 0), 0) / earlier.length);
    const outflow = outByMonth.get(latest) ?? 0;
    if (outflow >= SPIKE_MIN_PAISE && outflow >= SPIKE_RATIO * baseline) {
      flagged.push({
        ledgerName: String(ledger.name ?? ""),
        kind: classifyLedger(ledger) === "cash" ? "cash" : "bank",
        month: latest,
        outflowPaise: outflow,
        baselinePaise: baseline,
        baselineMonths: earlier.length,
        ratio: baseline > 0 ? Math.round((outflow / baseline) * 10) / 10 : Number.POSITIVE_INFINITY,
      });
    }
  }
  flagged.sort((a, b) => b.outflowPaise - a.outflowPaise);
  return { status: "resolved", asOn, checkedLedgers: targets.length, flagged };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cash runway (questionnaire 1.5)
//
//  Cash position  = signed total of all cash and bank ledgers (runCashBankTotal).
//  Monthly burn   = (position at the end of the month before the window − position at the end of
//                   the window's last month) ÷ 3, where the window is the three calendar months
//                   before the latest posted month.
//  Runway (days)  = current position (latest posting) ÷ (monthly burn ÷ 30).
// ─────────────────────────────────────────────────────────────────────────────

export type CashRunwayResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "no_data" }
  | { status: "short_history"; earliestDate: string; needsFrom: string }
  | {
      status: "resolved";
      latestDate: string;
      windowFrom: string;
      windowTo: string;
      startPositionPaise: number;
      endPositionPaise: number;
      currentPositionPaise: number;
      monthlyBurnPaise: number;
      runwayDays: number | null;
      reason: "runway" | "not_burning" | "exhausted";
    };

/** "YYYY-MM" shifted by a number of months. */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Last calendar day of a "YYYY-MM" month. */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function runCashRunway(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<CashRunwayResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value;

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const dates = ((await readVouchers(companyId)) as any[])
    .map((v) => normalizeStoredDate(v.voucher_date ?? v.date))
    .filter((d) => d && (!asOn || d <= asOn))
    .sort();
  if (dates.length === 0) return { status: "no_data" };
  const earliest = dates[0];
  const latestDate = dates[dates.length - 1];

  // The window: the three full months before the month of the latest posting.
  const latestMonth = latestDate.slice(0, 7);
  const windowFrom = shiftMonth(latestMonth, -3);
  const windowTo = shiftMonth(latestMonth, -1);
  const startAsOn = lastDayOfMonth(shiftMonth(windowFrom, -1));
  const endAsOn = lastDayOfMonth(windowTo);
  if (earliest > startAsOn) {
    return { status: "short_history", earliestDate: earliest, needsFrom: startAsOn };
  }

  const at = async (date: string | null) => {
    const r = await runCashBankTotal({ companyId, asOn: date });
    return r.status === "resolved" ? r.totalPaise : null;
  };
  const start = await at(startAsOn);
  const end = await at(endAsOn);
  const current = await at(latestDate);
  if (start === null || end === null || current === null) return { status: "no_data" };

  const monthlyBurn = Math.round((start - end) / 3);
  let reason: "runway" | "not_burning" | "exhausted";
  let runwayDays: number | null = null;
  if (current <= 0) reason = "exhausted";
  else if (monthlyBurn <= 0) reason = "not_burning";
  else {
    reason = "runway";
    runwayDays = Math.floor((current * 30) / monthlyBurn); // multiply first: exact in integer paise
  }
  return {
    status: "resolved",
    latestDate,
    windowFrom,
    windowTo,
    startPositionPaise: start,
    endPositionPaise: end,
    currentPositionPaise: current,
    monthlyBurnPaise: monthlyBurn,
    runwayDays,
    reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Customers over credit limit or overdue (questionnaire 2.2)
//
//  Over limit: outstanding receivable above the ledger's credit limit (only where one is set).
//  Overdue:    open bills past the ledger's credit days. Where the ledger has none, 30 days is used and
//              the row says so. Opening balances count as overdue (their age is not recorded).
//  Bills are settled by recorded allocations first, FIFO for the rest (settlement.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditWatchRow {
  ledgerId: string;
  name: string;
  outstandingPaise: number;
  creditLimitPaise: number | null;
  overLimitPaise: number;
  /** Open bills past their credit days (30 days where the ledger sets none). */
  overdue30Paise: number;
  creditDays: number;
  creditDaysSource: "ledger" | "default_30";
}

export type CreditWatchResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; asOn: string; checked: number; flagged: CreditWatchRow[] };

export async function runCreditWatch(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<CreditWatchResult> {
  const summary = await runPartySummary({ side: "receivable", asOn: query.asOn ?? null, companyId: query.companyId ?? null });
  if (summary.status === "no_company") return { status: "no_company" };
  if (summary.status === "invalid_date") return { status: "invalid_date", message: summary.message };

  const companyId = await resolveCompanyId(query.companyId);
  const ledgers = companyId ? ((await readLedgers(companyId)) as unknown as Array<{ id: unknown; credit_limit_paise?: unknown }>) : [];
  const limitById = new Map(ledgers.map((l) => [String(l.id), Number(l.credit_limit_paise ?? 0)]));

  const flagged: CreditWatchRow[] = [];
  for (const row of summary.rows) {
    const limit = limitById.get(row.ledgerId) ?? 0;
    const overLimit = limit > 0 && row.outstandingPaise > limit ? row.outstandingPaise - limit : 0;
    if (overLimit > 0 || row.overduePaise > 0) {
      flagged.push({
        ledgerId: row.ledgerId,
        name: row.name,
        outstandingPaise: row.outstandingPaise,
        creditLimitPaise: limit > 0 ? limit : null,
        overLimitPaise: overLimit,
        overdue30Paise: row.overduePaise,
        creditDays: row.creditDays,
        creditDaysSource: row.creditDaysSource,
      });
    }
  }
  flagged.sort((a, b) => b.overLimitPaise - a.overLimitPaise || b.overdue30Paise - a.overdue30Paise);
  return { status: "resolved", asOn: summary.asOn, checked: summary.rows.length, flagged };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Top customers by revenue and by overdue balance (questionnaire 2.5)
//
//  Revenue:  sum of sales voucher totals per customer (party ledger) in the period. Credit notes
//            are not deducted, as in the sales total.
//  Overdue:  receivable older than 30 days as on the period end (same rule as 2.2).
// ─────────────────────────────────────────────────────────────────────────────

export const RANKING_SIZE = 10;

export interface CustomerRevenueRow {
  ledgerId: string;
  name: string;
  revenuePaise: number;
  vouchers: number;
}

export interface CustomerOverdueRow {
  ledgerId: string;
  name: string;
  overduePaise: number;
  outstandingPaise: number;
}

export type CustomerRankingResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | {
      status: "resolved";
      from: string;
      to: string;
      byRevenue: CustomerRevenueRow[];
      byOverdue: CustomerOverdueRow[];
    };

export async function runCustomerRanking(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<CustomerRankingResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const from = fromArg.value ?? fyStartFor();
  const to = toArg.value ?? fyEndFor();

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const nameById = new Map(ledgers.map((l) => [String(l.id), String(l.name ?? "")]));

  // Revenue per customer from sales vouchers in the period.
  const { readVouchers } = await import("@/lib/offline/cache-read");
  const sales = (await readVouchers(companyId, { voucher_type: "sales" })) as any[];
  const revenue = new Map<string, { revenuePaise: number; vouchers: number }>();
  for (const v of sales) {
    const date = normalizeStoredDate(v.voucher_date ?? v.date);
    const party = v.party_ledger_id ? String(v.party_ledger_id) : null;
    if (!party || !date || date < from || date > to) continue;
    const cur = revenue.get(party) ?? { revenuePaise: 0, vouchers: 0 };
    cur.revenuePaise += Number(v.total_paise ?? 0);
    cur.vouchers += 1;
    revenue.set(party, cur);
  }
  const byRevenue: CustomerRevenueRow[] = [...revenue.entries()]
    .map(([ledgerId, r]) => ({ ledgerId, name: nameById.get(ledgerId) ?? "", revenuePaise: r.revenuePaise, vouchers: r.vouchers }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise)
    .slice(0, RANKING_SIZE);

  // Overdue per customer as on the period end.
  const summary = await runPartySummary({ side: "receivable", asOn: to, companyId });
  if (summary.status !== "resolved") {
    return summary.status === "invalid_date"
      ? { status: "invalid_date", message: summary.message }
      : { status: "no_company" };
  }
  const byOverdue: CustomerOverdueRow[] = summary.rows
    .map((row) => {
      return {
        ledgerId: row.ledgerId,
        name: row.name,
        overduePaise: row.overduePaise,
        outstandingPaise: row.outstandingPaise,
      };
    })
    .filter((r) => r.overduePaise > 0)
    .sort((a, b) => b.overduePaise - a.overduePaise)
    .slice(0, RANKING_SIZE);

  return { status: "resolved", from, to, byRevenue, byOverdue };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vendors overdue or with unadjusted advances (questionnaire 3.2)
//
//  Overdue:  payables past the vendor's credit days (30 where none is set; the row says so).
//  Advances: unmatched payments (vendor advances), reported apart from debit notes.
//  Debit notes: unmatched debit notes, reported apart from advances.
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorOverdueRow {
  ledgerId: string;
  name: string;
  overduePaise: number;
  outstandingPaise: number;
  advancePaise: number;
  debitNotePaise: number;
  creditDays: number;
  creditDaysSource: "ledger" | "default_30";
}

export type VendorOverdueResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; asOn: string; checked: number; flagged: VendorOverdueRow[] };

export async function runVendorOverdue(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<VendorOverdueResult> {
  const summary = await runPartySummary({ side: "payable", asOn: query.asOn ?? null, companyId: query.companyId ?? null });
  if (summary.status === "no_company") return { status: "no_company" };
  if (summary.status === "invalid_date") return { status: "invalid_date", message: summary.message };

  const flagged: VendorOverdueRow[] = [];
  for (const row of summary.rows) {
    if (row.overduePaise > 0 || row.advancePaise > 0 || row.vendorDebitNotePaise > 0) {
      flagged.push({
        ledgerId: row.ledgerId,
        name: row.name,
        overduePaise: row.overduePaise,
        outstandingPaise: row.outstandingPaise,
        advancePaise: row.advancePaise,
        debitNotePaise: row.vendorDebitNotePaise,
        creditDays: row.creditDays,
        creditDaysSource: row.creditDaysSource,
      });
    }
  }
  flagged.sort((a, b) => b.overduePaise - a.overduePaise || b.advancePaise + b.debitNotePaise - (a.advancePaise + a.debitNotePaise));
  return { status: "resolved", asOn: summary.asOn, checked: summary.rows.length, flagged };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vendor spend and payment cycle (questionnaire 3.3)
//
//  Purchases (for the period): gross purchase bills; less purchase returns (debit notes); less other
//  debit adjustments (journals, contra and other debits to the vendor, excluding payments); net.
//  Payment cycle: payments in the period are settled first by recorded bill allocations, then FIFO
//  for the unallocated part (settlement.ts). Days = payment date − bill date, weighted by amount.
//  Payments that settled an opening balance have no bill date and are reported, not timed.
//  Payments left after all bills are unmatched advances, reported separately.
//  Window: six calendar months ending in the latest posted month, unless from/to are given.
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorSpendCycleResolved {
  status: "resolved";
  vendor: string;
  from: string;
  to: string;
  /** Same as grossPurchasesPaise; kept for existing callers. */
  spendPaise: number;
  grossPurchasesPaise: number;
  purchaseReturnsPaise: number;
  debitAdjustmentsPaise: number;
  netPurchasesPaise: number;
  billCount: number;
  /** Payments in the period that settled a bill with a known date. */
  settledPaise: number;
  allocatedPaise: number;
  fifoPaise: number;
  openingSettledPaise: number;
  averageCycleDays: number | null;
  unmatchedPaymentsPaise: number;
  /** Recorded allocations for this vendor that could not be applied (any date). */
  unusableAllocations: number;
  method: "bill_allocations" | "mixed" | "fifo" | "none";
}

export type VendorSpendCycleResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "not_found"; query: string }
  | { status: "ambiguous"; query: string; candidates: string[] }
  | VendorSpendCycleResolved;

export async function runVendorSpendCycle(query: {
  vendorName: string;
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<VendorSpendCycleResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const found = resolveLedgerDeterministic(ledgers, query.vendorName);
  if (found.status === "not_found") return { status: "not_found", query: query.vendorName };
  if (found.status === "ambiguous") {
    return { status: "ambiguous", query: query.vendorName, candidates: found.candidates.map((c) => String(c.name)) };
  }
  const vendor = found.ledger;
  const vendorId = String(vendor.id);

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const vouchers = (await readVouchers(companyId)) as any[];
  const dates = vouchers.map((v) => normalizeStoredDate(v.voucher_date ?? v.date)).filter(Boolean).sort();
  const latest = dates[dates.length - 1];
  const toMonth = latest ? latest.slice(0, 7) : "1970-01";
  const from = fromArg.value ?? (latest ? `${shiftMonth(toMonth, -5)}-01` : "1970-01-01");
  const to = toArg.value ?? (latest ? lastDayOfMonth(toMonth) : "1970-01-01");
  const inWindow = (d: string) => d >= from && d <= to;

  const set = await loadLedgerPostings(companyId, vendorId, to, -1);
  const signedOpening = Number(vendor.opening_balance_paise ?? 0) * (vendor.opening_balance_is_debit === false ? -1 : 1);
  const opening = -signedOpening; // payable: a credit balance is owed to the vendor (positive)
  const allocs = (await allocationsByLedger(companyId)).get(vendorId) ?? [];
  const s = settleParty({ side: "payable", openingPaise: opening, postings: set.postings, allocations: allocs, asOn: to });

  // Purchase figures from the vendor's own postings in the period.
  let gross = 0;
  let returns = 0;
  let adjustments = 0;
  const billVouchers = new Set<string>();
  for (const p of set.postings) {
    if (!inWindow(p.date)) continue;
    if (p.voucherType === "purchase" && p.creditPaise > 0) {
      gross += p.creditPaise;
      billVouchers.add(p.voucherId);
    } else if (p.voucherType === "debit_note" && p.debitPaise > 0) {
      returns += p.debitPaise;
    } else if (p.voucherType !== "payment" && p.debitPaise > 0) {
      adjustments += p.debitPaise;
    }
  }

  // Payments in the period, by how they were matched.
  const apps = s.applications.filter((a) => a.settlementType === "payment" && inWindow(a.settlementDate));
  const dated = apps.filter((a) => a.billDate !== null);
  const settledPaise = dated.reduce((t, a) => t + a.amountPaise, 0);
  const weightedDays = dated.reduce((t, a) => t + daysBetween(a.billDate as string, a.settlementDate) * a.amountPaise, 0);
  const allocatedPaise = dated.filter((a) => a.method === "allocation").reduce((t, a) => t + a.amountPaise, 0);
  const fifoPaise = dated.filter((a) => a.method === "fifo").reduce((t, a) => t + a.amountPaise, 0);
  const openingSettledPaise = apps.filter((a) => a.billDate === null).reduce((t, a) => t + a.amountPaise, 0);
  const unmatchedPaymentsPaise = s.settlementRemainders
    .filter((r) => r.type === "payment" && inWindow(r.date))
    .reduce((t, r) => t + r.remainingPaise, 0);
  const method: VendorSpendCycleResolved["method"] =
    allocatedPaise > 0 && fifoPaise > 0 ? "mixed" : allocatedPaise > 0 ? "bill_allocations" : fifoPaise > 0 ? "fifo" : "none";

  return {
    status: "resolved",
    vendor: String(vendor.name ?? ""),
    from,
    to,
    spendPaise: gross,
    grossPurchasesPaise: gross,
    purchaseReturnsPaise: returns,
    debitAdjustmentsPaise: adjustments,
    netPurchasesPaise: gross - returns - adjustments,
    billCount: billVouchers.size,
    settledPaise,
    allocatedPaise,
    fifoPaise,
    openingSettledPaise,
    averageCycleDays: settledPaise > 0 ? Math.round((weightedDays / settledPaise) * 10) / 10 : null,
    unmatchedPaymentsPaise,
    unusableAllocations: s.invalid.length,
    method,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Duplicate bills, repeat payments and unusual purchase prices (questionnaire 3.4)
//
//  Definitions (disclosed in every answer):
//    Duplicate bill:   two or more purchase vouchers from the same vendor with the same reference number
//                      (the supplier's bill number). Vouchers without a reference are counted, not compared.
//    Repeat payment:   two or more payments to the same vendor of the same amount, dated within
//                      REPEAT_PAYMENT_WINDOW_DAYS of each other.
//    Price jump:       an item bought from the same vendor at a rate more than PRICE_JUMP_PCT above that
//                      vendor's previous purchase rate for the item. The default threshold is 25%.
//  Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICE_JUMP_PCT = 25;
export const REPEAT_PAYMENT_WINDOW_DAYS = 30;

export interface DuplicateBillFinding {
  vendor: string;
  billNo: string;
  voucherIds: string[];
  totalPaise: number;
}

export interface RepeatPaymentFinding {
  vendor: string;
  amountPaise: number;
  voucherIds: string[];
  dates: string[];
}

export interface PriceJumpFinding {
  vendor: string;
  item: string;
  date: string;
  previousRatePaise: number;
  ratePaise: number;
  changePct: number;
}

export type DuplicateCheckResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | {
      status: "resolved";
      from: string | null;
      to: string | null;
      purchaseCount: number;
      purchasesWithoutBillNo: number;
      duplicateBills: DuplicateBillFinding[];
      repeatPayments: RepeatPaymentFinding[];
      priceJumps: PriceJumpFinding[];
      thresholds: { priceJumpPct: number; repeatPaymentWindowDays: number };
    };

export async function runDuplicateCheck(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<DuplicateCheckResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const { offlineDb } = await import("@/lib/offline/db");
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const vendorName = new Map(ledgers.map((l) => [String(l.id), String(l.name ?? "")]));

  const all = ((await readVouchers(companyId)) as any[])
    .filter((v) => v && v.is_deleted !== true)
    .map((v) => ({
      id: String(v.id),
      type: String(v.voucher_type ?? ""),
      date: normalizeStoredDate(v.voucher_date ?? v.date),
      party: v.party_ledger_id ? String(v.party_ledger_id) : null,
      ref: String(v.ref_no ?? "").trim(),
      total: Number(v.total_paise ?? 0),
    }))
    .filter((v) => (!fromArg.value || v.date >= fromArg.value) && (!toArg.value || v.date <= toArg.value));

  const purchases = all
    .filter((v) => v.type === "purchase" && v.party)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const purchaseIds = new Map(purchases.map((p) => [p.id, p]));

  // Duplicate bill numbers from the same vendor.
  const byBill = new Map<string, typeof purchases>();
  let withoutBillNo = 0;
  for (const p of purchases) {
    if (!p.ref) {
      withoutBillNo++;
      continue;
    }
    const key = `${p.party}|${p.ref.toLowerCase()}`;
    byBill.set(key, [...(byBill.get(key) ?? []), p]);
  }
  const duplicateBills: DuplicateBillFinding[] = [...byBill.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      vendor: vendorName.get(g[0].party as string) ?? "",
      billNo: g[0].ref,
      voucherIds: g.map((x) => x.id),
      totalPaise: g.reduce((t, x) => t + x.total, 0),
    }))
    .sort((a, b) => b.totalPaise - a.totalPaise);

  // Same amount paid to the same vendor within the window.
  const payments = all
    .filter((v) => v.type === "payment" && v.party && v.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const byAmount = new Map<string, typeof payments>();
  for (const p of payments) {
    const key = `${p.party}|${p.total}`;
    byAmount.set(key, [...(byAmount.get(key) ?? []), p]);
  }
  const repeatPayments: RepeatPaymentFinding[] = [];
  for (const g of byAmount.values()) {
    if (g.length < 2) continue;
    const flagged = new Set<number>();
    for (let i = 1; i < g.length; i++) {
      if (daysBetween(g[i - 1].date, g[i].date) <= REPEAT_PAYMENT_WINDOW_DAYS) {
        flagged.add(i - 1);
        flagged.add(i);
      }
    }
    if (flagged.size === 0) continue;
    const members = [...flagged].sort((a, b) => a - b).map((i) => g[i]);
    repeatPayments.push({
      vendor: vendorName.get(g[0].party as string) ?? "",
      amountPaise: g[0].total,
      voucherIds: members.map((m) => m.id),
      dates: members.map((m) => m.date),
    });
  }

  // Unusual purchase prices: compare each purchase line with the previous rate for the same vendor and item.
  const lineRows = ((await offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray()) as any[])
    .filter((r) => r && r.is_deleted !== true && r.item_id && Number(r.rate_paise ?? 0) > 0 && purchaseIds.has(String(r.voucher_id)))
    .map((r) => ({ v: purchaseIds.get(String(r.voucher_id))!, item: String(r.item_id), rate: Number(r.rate_paise) }))
    .sort((a, b) => a.v.date.localeCompare(b.v.date) || a.v.id.localeCompare(b.v.id));
  const itemIds = [...new Set(lineRows.map((l) => l.item))];
  const itemRows = itemIds.length ? await offlineDb.cache_items.bulkGet(itemIds) : [];
  const itemName = new Map(itemIds.map((id, i) => [id, String((itemRows[i] as any)?.name ?? id)]));
  const lastRate = new Map<string, number>();
  const priceJumps: PriceJumpFinding[] = [];
  for (const l of lineRows) {
    const key = `${l.v.party}|${l.item}`;
    const prev = lastRate.get(key);
    if (prev && l.rate > prev * (1 + PRICE_JUMP_PCT / 100)) {
      priceJumps.push({
        vendor: vendorName.get(l.v.party as string) ?? "",
        item: itemName.get(l.item) ?? l.item,
        date: l.v.date,
        previousRatePaise: prev,
        ratePaise: l.rate,
        changePct: Math.round((l.rate / prev - 1) * 1000) / 10,
      });
    }
    lastRate.set(key, l.rate);
  }
  priceJumps.sort((a, b) => b.changePct - a.changePct);

  return {
    status: "resolved",
    from: fromArg.value ?? null,
    to: toArg.value ?? null,
    purchaseCount: purchases.length,
    purchasesWithoutBillNo: withoutBillNo,
    duplicateBills,
    repeatPayments,
    priceJumps,
    thresholds: { priceJumpPct: PRICE_JUMP_PCT, repeatPaymentWindowDays: REPEAT_PAYMENT_WINDOW_DAYS },
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Vendor concentration: which vendors make up the first 80% of purchase spend (questionnaire 3.5)
//
//  Spend = gross purchase bills per vendor in the period (purchase returns are not deducted).
//  Vendors are ranked by spend, largest first. The list stops at the vendor that takes the cumulative
//  share to CONCENTRATION_PCT or more, and that vendor is included. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export const CONCENTRATION_PCT = 80;

export interface ConcentrationRow {
  vendor: string;
  spendPaise: number;
  sharePct: number;
  cumulativePct: number;
}

export type VendorConcentrationResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | {
      status: "resolved";
      from: string | null;
      to: string | null;
      totalPaise: number;
      vendorCount: number;
      thresholdPct: number;
      /** Vendors up to and including the one that crosses the threshold. */
      rows: ConcentrationRow[];
      /** True when the threshold is reached within the rows shown. */
      reachedThreshold: boolean;
    };

export async function runVendorConcentration(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<VendorConcentrationResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const vendorName = new Map(ledgers.map((l) => [String(l.id), String(l.name ?? "")]));

  const spendByVendor = new Map<string, number>();
  for (const v of (await readVouchers(companyId)) as any[]) {
    if (!v || v.is_deleted === true || String(v.voucher_type ?? "") !== "purchase" || !v.party_ledger_id) continue;
    const date = normalizeStoredDate(v.voucher_date ?? v.date);
    if (fromArg.value && date < fromArg.value) continue;
    if (toArg.value && date > toArg.value) continue;
    const party = String(v.party_ledger_id);
    spendByVendor.set(party, (spendByVendor.get(party) ?? 0) + Number(v.total_paise ?? 0));
  }

  const ranked = [...spendByVendor.entries()]
    .filter(([, paise]) => paise > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ranked.reduce((t, [, paise]) => t + paise, 0);

  const rows: ConcentrationRow[] = [];
  let cumulative = 0;
  let reached = false;
  for (const [id, paise] of ranked) {
    cumulative += paise;
    const cumulativePct = total > 0 ? Math.round((cumulative / total) * 1000) / 10 : 0;
    rows.push({
      vendor: vendorName.get(id) ?? id,
      spendPaise: paise,
      sharePct: total > 0 ? Math.round((paise / total) * 1000) / 10 : 0,
      cumulativePct,
    });
    if (cumulativePct >= CONCENTRATION_PCT) {
      reached = true;
      break;
    }
  }

  return {
    status: "resolved",
    from: fromArg.value ?? null,
    to: toArg.value ?? null,
    totalPaise: total,
    vendorCount: ranked.length,
    thresholdPct: CONCENTRATION_PCT,
    rows,
    reachedThreshold: reached,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Monthly revenue and expense trend for the financial year (questionnaire 4.3)
//
//  Revenue : net credit to income ledgers of the sales kind (direct income), by voucher date.
//  Expense : net debit to direct and indirect expense ledgers, by voucher date.
//  Net     : revenue less expense (a profit figure before closing stock; see questionnaire item 7).
//  Months run from the start of the period to the latest month with a posting; later months are not shown.
//  Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyTrendRow {
  month: string;
  revenuePaise: number;
  expensePaise: number;
  netPaise: number;
  /** Change from the previous month shown; null for the first month or when the previous month is zero. */
  revenueChangePct: number | null;
  expenseChangePct: number | null;
}

export type MonthlyTrendResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | {
      status: "resolved";
      from: string;
      to: string;
      rows: MonthlyTrendRow[];
      revenueTotalPaise: number;
      expenseTotalPaise: number;
    };

export async function runMonthlyTrend(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<MonthlyTrendResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const from = fromArg.value ?? fyStartFor();
  const to = toArg.value ?? fyEndFor();

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const kindById = new Map(ledgers.map((l) => [String(l.id), classifyLedger(l)]));
  const { readVoucherEntriesWithVouchers } = await import("@/lib/offline/cache-read");
  const entries = (await readVoucherEntriesWithVouchers(companyId, { from, to })) as any[];

  const byMonth = new Map<string, { rev: number; exp: number }>();
  for (const e of entries) {
    if (e?.is_deleted === true) continue;
    const kind = kindById.get(String(e.ledger_id));
    // The entry reader nests the voucher under `vouchers`; its voucher_date is the posting date.
    const date = normalizeStoredDate(e.vouchers?.voucher_date ?? e.voucher_date ?? e.date);
    if (!date) continue;
    const m = date.slice(0, 7);
    const cur = byMonth.get(m) ?? { rev: 0, exp: 0 };
    const debit = Number(e.debit_paise ?? 0);
    const credit = Number(e.credit_paise ?? 0);
    if (kind === "direct_income") cur.rev += credit - debit;
    else if (kind === "direct_expense" || kind === "indirect_expense") cur.exp += debit - credit;
    byMonth.set(m, cur);
  }

  const rows: MonthlyTrendRow[] = [];
  const latest = [...byMonth.keys()].sort().pop();
  if (latest) {
    const endMonth = to.slice(0, 7) < latest ? to.slice(0, 7) : latest;
    let prev: { rev: number; exp: number } | null = null;
    for (let m = from.slice(0, 7); m <= endMonth; m = shiftMonth(m, 1)) {
      const cur = byMonth.get(m) ?? { rev: 0, exp: 0 };
      const pct = (now: number, before: number | undefined) =>
        before && before > 0 ? Math.round((now / before - 1) * 1000) / 10 : null;
      rows.push({
        month: m,
        revenuePaise: cur.rev,
        expensePaise: cur.exp,
        netPaise: cur.rev - cur.exp,
        revenueChangePct: prev ? pct(cur.rev, prev.rev) : null,
        expenseChangePct: prev ? pct(cur.exp, prev.exp) : null,
      });
      prev = cur;
    }
  }

  return {
    status: "resolved",
    from,
    to,
    rows,
    revenueTotalPaise: rows.reduce((t, r) => t + r.revenuePaise, 0),
    expenseTotalPaise: rows.reduce((t, r) => t + r.expensePaise, 0),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Sales and purchase returns, with reasons (questionnaire 4.5)
//
//  Sales returns    = credit note vouchers (total value and count).
//  Purchase returns = debit note vouchers.
//  Default period   = the current quarter of the financial year (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar).
//  Reason           = the narration on each voucher. A blank narration is reported as "no reason recorded".
//  Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export interface FyQuarter {
  from: string;
  to: string;
  label: string;
}

/** The financial-year quarter (April start) that contains the given date. */
export function fyQuarterFor(date: Date = new Date()): FyQuarter {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const fyStartYear = m >= 4 ? y : y - 1;
  const qIndex = Math.floor((((m - 4 + 12) % 12)) / 3); // 0..3
  const startMonthNo = ((3 + qIndex * 3) % 12) + 1; // 4, 7, 10, 1
  const startYear = startMonthNo >= 4 ? fyStartYear : fyStartYear + 1;
  const endTotal = startMonthNo + 2;
  const endMonthNo = ((endTotal - 1) % 12) + 1;
  const endYear = endTotal > 12 ? startYear + 1 : startYear;
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${startYear}-${pad(startMonthNo)}-01`;
  const to = lastDayOfMonth(`${endYear}-${pad(endMonthNo)}`);
  return { from, to, label: `Q${qIndex + 1} FY${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}` };
}

export interface ReturnRow {
  voucherNumber: string;
  date: string;
  party: string;
  amountPaise: number;
  reason: string | null;
}

export interface ReturnsBucket {
  totalPaise: number;
  count: number;
  rows: ReturnRow[];
}

export type ReturnsSummaryResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | {
      status: "resolved";
      from: string;
      to: string;
      periodLabel: string;
      salesReturns: ReturnsBucket;
      purchaseReturns: ReturnsBucket;
    };

export async function runReturnsSummary(query: {
  from?: string | null;
  to?: string | null;
  companyId?: string | null;
}): Promise<ReturnsSummaryResult> {
  const fromArg = coerceDateArg(query.from);
  const toArg = coerceDateArg(query.to);
  if (!fromArg.ok || !toArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const quarter = fyQuarterFor();
  const from = fromArg.value ?? quarter.from;
  const to = toArg.value ?? quarter.to;
  const periodLabel = fromArg.value || toArg.value ? `${from} to ${to}` : quarter.label;

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const partyName = new Map(ledgers.map((l) => [String(l.id), String(l.name ?? "")]));
  const vouchers = (await readVouchers(companyId)) as any[];

  const bucket = (type: string): ReturnsBucket => {
    const rows: ReturnRow[] = [];
    for (const v of vouchers) {
      if (!v || v.is_deleted === true || String(v.voucher_type ?? "") !== type) continue;
      const date = normalizeStoredDate(v.voucher_date ?? v.date);
      if (!date || date < from || date > to) continue;
      const reason = String(v.narration ?? "").trim();
      rows.push({
        voucherNumber: String(v.voucher_number ?? v.id),
        date,
        party: v.party_ledger_id ? partyName.get(String(v.party_ledger_id)) ?? "" : "",
        amountPaise: Number(v.total_paise ?? 0),
        reason: reason || null,
      });
    }
    rows.sort((a, b) => b.amountPaise - a.amountPaise || a.date.localeCompare(b.date));
    return { totalPaise: rows.reduce((t, r) => t + r.amountPaise, 0), count: rows.length, rows };
  };

  return {
    status: "resolved",
    from,
    to,
    periodLabel,
    salesReturns: bucket("credit_note"),
    purchaseReturns: bucket("debit_note"),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Stock quantity and valuation for one item (questionnaire 5.1, partial)
//
//  Quantity  = opening stock of the item + stock movements dated on or before the as-on date.
//              In:  purchase, receipt note, sales return (credit note), stock journal in.
//              Out: sales, delivery note, purchase return (debit note), stock journal out.
//              Manufacturing vouchers are not counted (the same rule the negative-stock check uses).
//  Value     = quantity × valuation rate. Rate = the last purchase rate on or before the as-on date;
//              otherwise the opening stock rate; otherwise the item's purchase price. Each is named.
//  Godowns   = not available. The books do not record a godown on stock lines, so the figure is the
//              total across all godowns.
//  Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export const STOCK_IN_TYPES = ["purchase", "receipt_note", "credit_note", "stock_journal_in"];
export const STOCK_OUT_TYPES = ["sales", "delivery_note", "debit_note", "stock_journal_out"];

export type ItemStockResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "not_found"; query: string }
  | { status: "ambiguous"; query: string; candidates: string[] }
  | {
      status: "resolved";
      item: string;
      unit: string;
      asOn: string;
      openingQty: number;
      movementQty: number;
      closingQty: number;
      valuationRatePaise: number | null;
      rateSource: "last_purchase" | "opening_rate" | "purchase_price" | "none";
      rateDate: string | null;
      valuePaise: number | null;
    };

export async function runItemStock(query: {
  itemName: string;
  asOn?: string | null;
  companyId?: string | null;
}): Promise<ItemStockResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value ?? new Date().toISOString().slice(0, 10);

  const { offlineDb } = await import("@/lib/offline/db");
  const live = ((await offlineDb.cache_items.where("company_id").equals(companyId).toArray()) as any[]).filter(
    (i) => i && i.is_deleted !== true,
  );
  const q = query.itemName.trim().toLowerCase();
  let matches = live.filter((i) => String(i.name ?? "").trim().toLowerCase() === q);
  if (matches.length === 0) matches = live.filter((i) => String(i.name ?? "").toLowerCase().includes(q));
  if (q === "") return { status: "not_found", query: query.itemName };
  if (matches.length === 0) return { status: "not_found", query: query.itemName };
  if (matches.length > 1) {
    return { status: "ambiguous", query: query.itemName, candidates: matches.map((m) => String(m.name)) };
  }
  const item = matches[0];
  const itemId = String(item.id);

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const vouchers = (await readVouchers(companyId)) as any[];
  const voucherById = new Map(
    vouchers.map((v) => [String(v.id), { type: String(v.voucher_type ?? ""), date: normalizeStoredDate(v.voucher_date ?? v.date) }]),
  );
  const lines = ((await offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray()) as any[]).filter(
    (r) => r && r.is_deleted !== true && String(r.item_id) === itemId,
  );

  let movement = 0;
  let lastPurchase: { date: string; rate: number } | null = null;
  for (const r of lines) {
    const v = voucherById.get(String(r.voucher_id));
    if (!v || !v.date || v.date > asOn) continue;
    const qty = Math.abs(Number(r.qty ?? 0));
    if (STOCK_IN_TYPES.includes(v.type)) movement += qty;
    else if (STOCK_OUT_TYPES.includes(v.type)) movement -= qty;
    const rate = Number(r.rate_paise ?? 0);
    if (v.type === "purchase" && rate > 0 && (!lastPurchase || v.date >= lastPurchase.date)) {
      lastPurchase = { date: v.date, rate };
    }
  }

  const openingQty = Number(item.opening_stock_qty ?? 0);
  const closingQty = openingQty + movement;
  let rate: number | null = null;
  let rateSource: "last_purchase" | "opening_rate" | "purchase_price" | "none" = "none";
  let rateDate: string | null = null;
  if (lastPurchase) {
    rate = lastPurchase.rate;
    rateSource = "last_purchase";
    rateDate = lastPurchase.date;
  } else if (Number(item.opening_stock_rate_paise ?? 0) > 0) {
    rate = Number(item.opening_stock_rate_paise);
    rateSource = "opening_rate";
  } else if (Number(item.purchase_price_paise ?? 0) > 0) {
    rate = Number(item.purchase_price_paise);
    rateSource = "purchase_price";
  }

  return {
    status: "resolved",
    item: String(item.name ?? ""),
    unit: String(item.unit ?? ""),
    asOn,
    openingQty,
    movementQty: movement,
    closingQty,
    valuationRatePaise: rate,
    rateSource,
    rateDate,
    valuePaise: rate === null ? null : Math.round(closingQty * rate),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Fast-moving, slow-moving and dead stock (questionnaire 5.2)
//
//  Only items on hand (closing quantity above zero) are classified. Movements are the stock lines
//  counted in item stock (5.1). Classes, checked in this order:
//    fast    : at least MOVEMENT_FAST_COUNT movements in the last MOVEMENT_FAST_DAYS days
//    dead    : no movement for more than MOVEMENT_DEAD_DAYS days, or never moved
//    slow    : last movement more than MOVEMENT_SLOW_DAYS days ago
//    normal  : anything else (moved recently, but not often enough to be fast)
//  The thresholds are defaults and are stated in each answer. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_FAST_COUNT = 3;
export const MOVEMENT_FAST_DAYS = 30;
export const MOVEMENT_SLOW_DAYS = 30;
export const MOVEMENT_DEAD_DAYS = 90;

export type StockClass = "fast" | "normal" | "slow" | "dead";

export interface StockMovementRow {
  item: string;
  unit: string;
  closingQty: number;
  lastMovementDate: string | null;
  daysSinceMovement: number | null;
  movementsLast30: number;
  classification: StockClass;
}

export type StockMovementResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "resolved"; asOn: string; counted: number; rows: StockMovementRow[] };

export async function runStockMovement(query: {
  asOn?: string | null;
  companyId?: string | null;
}): Promise<StockMovementResult> {
  const asOnArg = coerceDateArg(query.asOn);
  if (!asOnArg.ok) return { status: "invalid_date", message: INVALID_DATE_MESSAGE };
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };
  const asOn = asOnArg.value ?? new Date().toISOString().slice(0, 10);
  const windowStart = (() => {
    const d = new Date(`${asOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - MOVEMENT_FAST_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  const { offlineDb } = await import("@/lib/offline/db");
  const { readVouchers } = await import("@/lib/offline/cache-read");
  const items = ((await offlineDb.cache_items.where("company_id").equals(companyId).toArray()) as any[]).filter(
    (i) => i && i.is_deleted !== true,
  );
  const vouchers = (await readVouchers(companyId)) as any[];
  const voucherById = new Map(
    vouchers.map((v) => [String(v.id), { type: String(v.voucher_type ?? ""), date: normalizeStoredDate(v.voucher_date ?? v.date) }]),
  );
  const lines = (await offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray()) as any[];

  const agg = new Map<string, { qty: number; last: string | null; recent: number }>();
  for (const r of lines) {
    if (!r || r.is_deleted === true || !r.item_id) continue;
    const v = voucherById.get(String(r.voucher_id));
    if (!v || !v.date || v.date > asOn) continue;
    const isIn = STOCK_IN_TYPES.includes(v.type);
    const isOut = STOCK_OUT_TYPES.includes(v.type);
    if (!isIn && !isOut) continue;
    const id = String(r.item_id);
    const a = agg.get(id) ?? { qty: 0, last: null, recent: 0 };
    a.qty += Math.abs(Number(r.qty ?? 0)) * (isIn ? 1 : -1);
    if (!a.last || v.date > a.last) a.last = v.date;
    if (v.date >= windowStart) a.recent++;
    agg.set(id, a);
  }

  const rows: StockMovementRow[] = [];
  for (const item of items) {
    const a = agg.get(String(item.id)) ?? { qty: 0, last: null, recent: 0 };
    const closingQty = Number(item.opening_stock_qty ?? 0) + a.qty;
    if (!(closingQty > 0)) continue;
    const days = a.last ? daysBetween(a.last, asOn) : null;
    let classification: StockClass;
    if (a.recent >= MOVEMENT_FAST_COUNT) classification = "fast";
    else if (days === null || days > MOVEMENT_DEAD_DAYS) classification = "dead";
    else if (days > MOVEMENT_SLOW_DAYS) classification = "slow";
    else classification = "normal";
    rows.push({
      item: String(item.name ?? ""),
      unit: String(item.unit ?? ""),
      closingQty,
      lastMovementDate: a.last,
      daysSinceMovement: days,
      movementsLast30: a.recent,
      classification,
    });
  }
  rows.sort((x, y) => (y.daysSinceMovement ?? Infinity) - (x.daysSinceMovement ?? Infinity) || x.item.localeCompare(y.item));

  return { status: "resolved", asOn, counted: rows.length, rows };
}
