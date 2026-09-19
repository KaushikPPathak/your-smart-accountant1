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

  const candidates = ledgers.filter((l) => {
    const tokens = new Set(stripHonorifics(l.name).split(" ").filter(Boolean));
    return qTokens.every((t) => tokens.has(t));
  });

  if (candidates.length === 1) return { status: "resolved", ledger: candidates[0] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "not_found" };
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
