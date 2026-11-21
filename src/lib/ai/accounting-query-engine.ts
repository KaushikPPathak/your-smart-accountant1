import { ageOutstanding, type AgedOutstanding, type AgingBucket, type AgingSide, type DatedEntry } from "./aging";
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
// ─────────────────────────────────────────────────────────────────────────────

export interface PartySummaryRow {
  ledgerId: string;
  name: string;
  outstandingPaise: number;
  advancePaise: number;
  buckets: AgedOutstanding["buckets"];
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

/**
 * Outstanding receivables (sundry debtors) or payables (sundry creditors) for every party,
 * largest first, with the same ageing buckets for each party. Figures come from the books
 * as on the given date, never from a cached answer.
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

  const { offlineDb } = await import("@/lib/offline/db");
  const wantGroup = query.side === "receivable" ? "debtor" : "creditor";
  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const parties = ledgers.filter((l) => (l.group_name ?? "").toLowerCase().includes(wantGroup));

  const rows: PartySummaryRow[] = [];
  for (const ledger of parties) {
    const entries: DatedEntry[] = [];
    const raw: Array<{ voucher_id: unknown; debit_paise?: unknown; credit_paise?: unknown; is_deleted?: boolean }> = [];
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
    for (const e of raw) {
      const date = dateById.get(String(e.voucher_id));
      if (!date || date > asOn) continue;
      entries.push({ date, debitPaise: Number(e.debit_paise ?? 0), creditPaise: Number(e.credit_paise ?? 0) });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Signed opening balance: positive is a debit. Receivables are owed in the debit direction;
    // payables are owed in the credit direction.
    const signedOpening = Number(ledger.opening_balance_paise ?? 0) * (ledger.opening_balance_is_debit === false ? -1 : 1);
    const opening = query.side === "receivable" ? signedOpening : -signedOpening;
    const aged = ageOutstanding(query.side, opening, entries, asOn);
    if (aged.outstandingPaise === 0 && aged.advancePaise === 0) continue;
    rows.push({
      ledgerId: String(ledger.id),
      name: ledger.name,
      outstandingPaise: aged.outstandingPaise,
      advancePaise: aged.advancePaise,
      buckets: aged.buckets,
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
//  Overdue:    any receivable older than 30 days. Opening balances count as overdue, because
//              their age is not recorded. Credit days on the ledger are not used yet.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditWatchRow {
  ledgerId: string;
  name: string;
  outstandingPaise: number;
  creditLimitPaise: number | null;
  overLimitPaise: number;
  overdue30Paise: number;
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
    const b = row.buckets;
    const overdue30 = b.opening + b.d31_60 + b.d61_90 + b.d90p;
    const limit = limitById.get(row.ledgerId) ?? 0;
    const overLimit = limit > 0 && row.outstandingPaise > limit ? row.outstandingPaise - limit : 0;
    if (overLimit > 0 || overdue30 > 0) {
      flagged.push({
        ledgerId: row.ledgerId,
        name: row.name,
        outstandingPaise: row.outstandingPaise,
        creditLimitPaise: limit > 0 ? limit : null,
        overLimitPaise: overLimit,
        overdue30Paise: overdue30,
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
      const b = row.buckets;
      return {
        ledgerId: row.ledgerId,
        name: row.name,
        overduePaise: b.opening + b.d31_60 + b.d61_90 + b.d90p,
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
//  Overdue:  payable older than 30 days as on the as-on date (same rule as 2.2, for vendors).
//            Opening balances count as overdue, because their age is not recorded.
//  Advance:  money paid or debit notes raised that the ageing could not match to a bill
//            (the ageing settles the oldest bill first, so this is the unmatched excess).
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorOverdueRow {
  ledgerId: string;
  name: string;
  overduePaise: number;
  outstandingPaise: number;
  advancePaise: number;
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
    const b = row.buckets;
    const overdue = b.opening + b.d31_60 + b.d61_90 + b.d90p;
    if (overdue > 0 || row.advancePaise > 0) {
      flagged.push({
        ledgerId: row.ledgerId,
        name: row.name,
        overduePaise: overdue,
        outstandingPaise: row.outstandingPaise,
        advancePaise: row.advancePaise,
      });
    }
  }
  flagged.sort((a, b) => b.overduePaise - a.overduePaise || b.advancePaise - a.advancePaise);
  return { status: "resolved", asOn: summary.asOn, checked: summary.rows.length, flagged };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vendor spend and payment cycle (questionnaire 3.3)
//
//  Spend:        purchase bills to the vendor dated in the window (credit side of purchase
//                vouchers on the vendor ledger). Purchase returns and debit notes are NOT deducted.
//  Payment cycle: each payment is matched FIFO to the oldest open bill it can settle (bills dated on
//                or before the payment). Days = payment date − bill date, weighted by matched
//                amount, for payments dated in the window. Bill-wise allocation is not stored, so
//                FIFO is the disclosed method. Payment left over after all bills is an advance and is
//                reported separately.
//  Window:       six calendar months ending in the latest posted month, unless from/to are given.
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorSpendCycleResolved {
  status: "resolved";
  vendor: string;
  from: string;
  to: string;
  spendPaise: number;
  billCount: number;
  settledPaise: number;
  averageCycleDays: number | null;
  unmatchedPaymentsPaise: number;
  method: "fifo";
}

export type VendorSpendCycleResult =
  | { status: "no_company" }
  | { status: "invalid_date"; message: string }
  | { status: "not_found"; query: string }
  | { status: "ambiguous"; query: string; candidates: string[] }
  | VendorSpendCycleResolved;

const DAY_MS = 86_400_000;

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

  const { readVouchers } = await import("@/lib/offline/cache-read");
  const { offlineDb } = await import("@/lib/offline/db");
  const vouchers = (await readVouchers(companyId)) as any[];
  const info = new Map<string, { date: string; type: string }>();
  for (const v of vouchers) {
    const date = normalizeStoredDate(v.voucher_date ?? v.date);
    if (date) info.set(String(v.id), { date, type: String(v.voucher_type ?? "") });
  }

  const entries = await offlineDb.cache_voucher_entries
    .where("[company_id+ledger_id]")
    .equals([companyId, String(vendor.id)])
    .toArray();

  const bills: { date: string; remaining: number; amount: number }[] = [];
  const payments: { date: string; amount: number }[] = [];
  for (const e of entries as any[]) {
    if (e.is_deleted === true) continue;
    const v = info.get(String(e.voucher_id));
    if (!v) continue;
    if (v.type === "purchase" && Number(e.credit_paise ?? 0) > 0) {
      const amount = Number(e.credit_paise);
      bills.push({ date: v.date, remaining: amount, amount });
    } else if (v.type === "payment" && Number(e.debit_paise ?? 0) > 0) {
      payments.push({ date: v.date, amount: Number(e.debit_paise) });
    }
  }
  bills.sort((a, b) => a.date.localeCompare(b.date));
  payments.sort((a, b) => a.date.localeCompare(b.date));

  // Window: explicit dates, else the six months ending in the latest posted month.
  const allDates = [...info.values()].map((v) => v.date).sort();
  const latest = allDates[allDates.length - 1];
  const toMonth = latest ? latest.slice(0, 7) : "1970-01";
  const from = fromArg.value ?? (latest ? `${shiftMonth(toMonth, -5)}-01` : "1970-01-01");
  const to = toArg.value ?? (latest ? lastDayOfMonth(toMonth) : "1970-01-01");
  const inWindow = (d: string) => d >= from && d <= to;

  const spendPaise = bills.filter((b) => inWindow(b.date)).reduce((s, b) => s + b.amount, 0);
  const billCount = bills.filter((b) => inWindow(b.date)).length;

  let settledPaise = 0;
  let weightedDays = 0;
  let unmatchedPaymentsPaise = 0;
  for (const p of payments) {
    let left = p.amount;
    for (const bill of bills) {
      if (left <= 0) break;
      if (bill.date > p.date || bill.remaining <= 0) continue;
      const take = Math.min(left, bill.remaining);
      bill.remaining -= take;
      left -= take;
      if (inWindow(p.date)) {
        settledPaise += take;
        weightedDays += ((Date.parse(p.date) - Date.parse(bill.date)) / DAY_MS) * take;
      }
    }
    if (inWindow(p.date)) unmatchedPaymentsPaise += left;
  }

  return {
    status: "resolved",
    vendor: String(vendor.name ?? ""),
    from,
    to,
    spendPaise,
    billCount,
    settledPaise,
    averageCycleDays: settledPaise > 0 ? Math.round((weightedDays / settledPaise) * 10) / 10 : null,
    unmatchedPaymentsPaise,
    method: "fifo",
  };
}
