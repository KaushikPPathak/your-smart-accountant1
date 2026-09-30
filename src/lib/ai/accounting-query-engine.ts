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

export type AccountingQueryResult =
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

export const BANK_ALIASES: Record<string, string> = {
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
  ubi: "union bank of india",
  canara: "canara bank",
};

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
  const aliased = BANK_ALIASES[raw] ?? raw;

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
      if (v && v.is_deleted !== true) dateById.set(ids[i], String(v.voucher_date ?? v.date ?? ""));
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
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const ledgers = (await readLedgers(companyId)) as unknown as EngineLedger[];
  const asOn = query.asOn ? String(query.asOn) : null;

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
  const vouchers = (await offlineDb.cache_vouchers
    .where("[company_id+voucher_date]")
    .between([companyId, ""], [companyId, asOn], true, true)
    .toArray()) as Array<{ id?: unknown; voucher_date?: unknown; is_deleted?: boolean }>;

  const live = vouchers.filter((v) => v?.is_deleted !== true);
  const dateById = new Map(live.map((v) => [String(v.id), String(v.voucher_date ?? "")]));
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
): Promise<TrialBalanceResult | { status: "no_company" }> {
  const companyId = await resolveCompanyId(query.companyId);
  if (!companyId) return { status: "no_company" };

  const asOn = query.asOn ? String(query.asOn) : fyEndFor();
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
      date: String(v.voucher_date ?? v.date ?? ""),
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
