// Phase A1 — Persistent assistant memory.
//
// Per-(user, company) learned patterns kept in local IndexedDB (never
// synced to the cloud — same local-only guarantee as all business data).
// Now covers three layers:
//   1. PartyPattern       — recurring counter-ledger / RCM / intent per party.
//   2. UserPrefs          — cross-company user style (language, rounding, tone).
//   3. CompanyProfile     — frequent HSN / GST rates / narrations / top parties.
//   4. CorrectionLog      — every time the user overrides an AI draft, log it.
//
// All four collapse into one JSON blob per key in the `meta` table so no
// schema migration is needed.

import { getMeta, setMeta } from "@/lib/offline/db";
import { phoneticKey, stripHonorifics } from "./phonetic";

// ─── Party patterns ─────────────────────────────────────────────────────────

export interface PartyPattern {
  key: string;
  displayName: string;
  counterLedgerId?: string;
  counterLedgerName?: string;
  rcmPercent?: number;
  intent?: string;
  hits: number;
  lastSeen: string;
  note?: string;
}

export interface AssistantMemory {
  companyId: string;
  partyPatterns: Record<string, PartyPattern>;
  updatedAt: string;
}

function memKey(companyId: string): string { return `assistant.memory.${companyId}`; }

export async function loadAssistantMemory(companyId: string): Promise<AssistantMemory> {
  const raw = await getMeta<AssistantMemory>(memKey(companyId));
  if (raw && raw.partyPatterns) return raw;
  return { companyId, partyPatterns: {}, updatedAt: new Date().toISOString() };
}

async function saveAssistantMemory(m: AssistantMemory): Promise<void> {
  m.updatedAt = new Date().toISOString();
  await setMeta(memKey(m.companyId), m);
}

export function partyMemoryKey(name: string): string {
  return phoneticKey(stripHonorifics(name));
}

export async function recallPartyPattern(companyId: string, partyName: string): Promise<PartyPattern | null> {
  if (!companyId || !partyName) return null;
  const mem = await loadAssistantMemory(companyId);
  return mem.partyPatterns[partyMemoryKey(partyName)] ?? null;
}

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

export async function forgetPartyPattern(companyId: string, partyName: string): Promise<void> {
  const mem = await loadAssistantMemory(companyId);
  delete mem.partyPatterns[partyMemoryKey(partyName)];
  await saveAssistantMemory(mem);
}

export async function listPartyPatterns(companyId: string): Promise<PartyPattern[]> {
  const mem = await loadAssistantMemory(companyId);
  return Object.values(mem.partyPatterns).sort((a, b) => b.hits - a.hits);
}

// ─── User prefs (cross-company) ─────────────────────────────────────────────

export interface UserPrefs {
  language?: "en" | "hi" | "gu";
  roundingRupees?: number;         // e.g. 1 or 10 — user rounds totals to this
  preferPhoneticNames?: boolean;   // preserve Gujarati/Hindi spellings verbatim
  teachMode?: boolean;             // show reasoning in AI answers
  tone?: "concise" | "detailed";
  updatedAt: string;
}

const USER_PREFS_KEY = "assistant.userPrefs";

export async function loadUserPrefs(): Promise<UserPrefs> {
  const raw = await getMeta<UserPrefs>(USER_PREFS_KEY);
  return raw ?? { updatedAt: new Date().toISOString() };
}

export async function saveUserPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs> {
  const current = await loadUserPrefs();
  const next: UserPrefs = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await setMeta(USER_PREFS_KEY, next);
  return next;
}

// ─── Company profile (auto-learned business shape) ──────────────────────────

export interface CompanyProfile {
  companyId: string;
  topParties: { name: string; hits: number }[];
  commonHsn: { code: string; hits: number }[];
  commonGstRates: { rate: number; hits: number }[];
  commonNarrations: { text: string; hits: number }[];
  updatedAt: string;
}

function profileKey(companyId: string): string { return `assistant.profile.${companyId}`; }

export async function loadCompanyProfile(companyId: string): Promise<CompanyProfile> {
  const raw = await getMeta<CompanyProfile>(profileKey(companyId));
  if (raw) return raw;
  return {
    companyId, topParties: [], commonHsn: [], commonGstRates: [], commonNarrations: [],
    updatedAt: new Date().toISOString(),
  };
}

function bump<T extends { hits: number }>(list: T[], match: (t: T) => boolean, make: () => T, cap = 25): T[] {
  const idx = list.findIndex(match);
  if (idx >= 0) list[idx].hits += 1;
  else list.push(make());
  return list.sort((a, b) => b.hits - a.hits).slice(0, cap);
}

export async function noteCompanyActivity(
  companyId: string,
  patch: { partyName?: string; hsn?: string; gstRate?: number; narration?: string },
): Promise<void> {
  if (!companyId) return;
  const p = await loadCompanyProfile(companyId);
  if (patch.partyName)
    p.topParties = bump(p.topParties, x => x.name === patch.partyName, () => ({ name: patch.partyName!, hits: 1 }));
  if (patch.hsn)
    p.commonHsn = bump(p.commonHsn, x => x.code === patch.hsn, () => ({ code: patch.hsn!, hits: 1 }));
  if (typeof patch.gstRate === "number")
    p.commonGstRates = bump(p.commonGstRates, x => x.rate === patch.gstRate, () => ({ rate: patch.gstRate!, hits: 1 }), 10);
  if (patch.narration && patch.narration.trim().length > 2) {
    const norm = patch.narration.trim().slice(0, 120);
    p.commonNarrations = bump(p.commonNarrations, x => x.text === norm, () => ({ text: norm, hits: 1 }), 20);
  }
  p.updatedAt = new Date().toISOString();
  await setMeta(profileKey(companyId), p);
}

// ─── Correction log (learning from user overrides) ──────────────────────────

export interface CorrectionEntry {
  id: string;
  companyId: string;
  at: string;
  kind: "voucher_edit" | "verifier_override" | "party_correction" | "rate_correction";
  before: unknown;
  after: unknown;
  note?: string;
}

function correctionKey(companyId: string): string { return `assistant.corrections.${companyId}`; }

export async function loadCorrections(companyId: string, limit = 50): Promise<CorrectionEntry[]> {
  const raw = (await getMeta<CorrectionEntry[]>(correctionKey(companyId))) ?? [];
  return raw.slice(0, limit);
}

export async function logCorrection(entry: Omit<CorrectionEntry, "id" | "at">): Promise<void> {
  if (!entry.companyId) return;
  const list = (await getMeta<CorrectionEntry[]>(correctionKey(entry.companyId))) ?? [];
  const full: CorrectionEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  };
  list.unshift(full);
  await setMeta(correctionKey(entry.companyId), list.slice(0, 200));
}

// ─── Snapshot for prompt injection ──────────────────────────────────────────

/**
 * Compact text block the sqliteContext injects into every system prompt so
 * the AI matches the user's preferred style and the company's usual shape.
 * Kept small (≤ ~600 chars) — this ships with every request.
 */
export async function buildMemorySnapshot(companyId: string | null | undefined): Promise<string> {
  const prefs = await loadUserPrefs();
  const lines: string[] = [];
  if (prefs.language) lines.push(`User language: ${prefs.language}.`);
  if (prefs.roundingRupees) lines.push(`User rounds totals to ₹${prefs.roundingRupees}.`);
  if (prefs.tone) lines.push(`Tone: ${prefs.tone}.`);
  if (prefs.preferPhoneticNames) lines.push("Preserve regional-script party names verbatim.");
  if (prefs.teachMode) lines.push("Teach mode ON — show reasoning + cite standards (§44AD, AS-2, MSMED §16).");

  if (companyId) {
    const [profile, corrections] = await Promise.all([
      loadCompanyProfile(companyId),
      loadCorrections(companyId, 5),
    ]);
    if (profile.topParties.length)
      lines.push(`Frequent parties: ${profile.topParties.slice(0, 5).map(p => p.name).join(", ")}.`);
    if (profile.commonHsn.length)
      lines.push(`Common HSN: ${profile.commonHsn.slice(0, 5).map(h => h.code).join(", ")}.`);
    if (profile.commonGstRates.length)
      lines.push(`Common GST rates: ${profile.commonGstRates.slice(0, 4).map(r => r.rate + "%").join(", ")}.`);
    if (corrections.length)
      lines.push(`Recent user corrections to remember (${corrections.length}): the user recently overrode AI drafts — respect their edits.`);
  }
  if (lines.length === 0) return "";
  return "LEARNED USER/COMPANY CONTEXT (respect these):\n" + lines.map(l => "  • " + l).join("\n");
}
