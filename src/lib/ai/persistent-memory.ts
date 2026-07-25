// Phase 4 — Persistent assistant memory.
//
// Per-(user, company) learned patterns kept in local IndexedDB (never
// synced to the cloud — same local-only guarantee as all business data).
// Used by the assistant to say things like:
//
//   "You always book audit-fee entries under Professional Fees – 40% RCM.
//    Apply same here?"
//
// Storage is a single JSON blob under `assistant.memory.<companyId>` in the
// existing `meta` table — no schema migration needed.

import { getMeta, setMeta } from "@/lib/offline/db";
import { phoneticKey, stripHonorifics } from "./phonetic";

export interface PartyPattern {
  /** Phonetic key of the party name — the lookup key. */
  key: string;
  /** Human-readable name last seen. */
  displayName: string;
  /** Preferred expense/income ledger for this party. */
  counterLedgerId?: string;
  counterLedgerName?: string;
  /** Reverse-charge percentage the user typically applies (0 = not RCM). */
  rcmPercent?: number;
  /** Preferred voucher intent (purchase/sales/payment/receipt). */
  intent?: string;
  /** How many times this pattern has been reinforced. */
  hits: number;
  /** Last time the user confirmed the pattern (ISO). */
  lastSeen: string;
  /** Free-form note the user typed when saving. */
  note?: string;
}

export interface AssistantMemory {
  companyId: string;
  partyPatterns: Record<string, PartyPattern>;
  updatedAt: string;
}

function memKey(companyId: string): string {
  return `assistant.memory.${companyId}`;
}

export async function loadAssistantMemory(companyId: string): Promise<AssistantMemory> {
  const raw = await getMeta<AssistantMemory>(memKey(companyId));
  if (raw && raw.partyPatterns) return raw;
  return { companyId, partyPatterns: {}, updatedAt: new Date().toISOString() };
}

async function saveAssistantMemory(m: AssistantMemory): Promise<void> {
  m.updatedAt = new Date().toISOString();
  await setMeta(memKey(m.companyId), m);
}

/** Canonical key for a party name — phonetic + honorific-stripped. */
export function partyMemoryKey(name: string): string {
  return phoneticKey(stripHonorifics(name));
}

/** Recall a learned pattern for a party, if any. */
export async function recallPartyPattern(
  companyId: string,
  partyName: string,
): Promise<PartyPattern | null> {
  if (!companyId || !partyName) return null;
  const mem = await loadAssistantMemory(companyId);
  const key = partyMemoryKey(partyName);
  return mem.partyPatterns[key] ?? null;
}

/** Store or reinforce a party pattern. Merge on top of any existing row. */
export async function rememberPartyPattern(
  companyId: string,
  partyName: string,
  patch: Partial<Omit<PartyPattern, "key" | "hits" | "lastSeen" | "displayName">> & { note?: string },
): Promise<PartyPattern> {
  const mem = await loadAssistantMemory(companyId);
  const key = partyMemoryKey(partyName);
  const existing = mem.partyPatterns[key];
  const merged: PartyPattern = {
    key,
    displayName: partyName,
    counterLedgerId: patch.counterLedgerId ?? existing?.counterLedgerId,
    counterLedgerName: patch.counterLedgerName ?? existing?.counterLedgerName,
    rcmPercent: patch.rcmPercent ?? existing?.rcmPercent,
    intent: patch.intent ?? existing?.intent,
    note: patch.note ?? existing?.note,
    hits: (existing?.hits ?? 0) + 1,
    lastSeen: new Date().toISOString(),
  };
  mem.partyPatterns[key] = merged;
  await saveAssistantMemory(mem);
  return merged;
}

/** Forget a specific party's pattern. */
export async function forgetPartyPattern(companyId: string, partyName: string): Promise<void> {
  const mem = await loadAssistantMemory(companyId);
  delete mem.partyPatterns[partyMemoryKey(partyName)];
  await saveAssistantMemory(mem);
}

/** List all remembered patterns for the UI. */
export async function listPartyPatterns(companyId: string): Promise<PartyPattern[]> {
  const mem = await loadAssistantMemory(companyId);
  return Object.values(mem.partyPatterns).sort((a, b) => b.hits - a.hits);
}
