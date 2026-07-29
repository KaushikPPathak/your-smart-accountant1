// Local-only bank statement storage + matching helpers.
// Business rule: raw bank statements NEVER leave the device. They live in
// IndexedDB (cache_bank_statements / cache_bank_statement_lines) and are
// excluded from cloud backup and sync.
import { offlineDb } from "@/lib/offline/db";
import { readVouchers } from "@/lib/offline/cache-read";
import type { ParsedBankLine } from "./parse-client";

export interface LocalBankStatement {
  id: string;
  company_id: string;
  bank_ledger_id: string;
  file_name: string;
  from_date: string;
  to_date: string;
  total_lines: number;
  imported_at: string;
}

export interface LocalBankLine {
  id: string;
  statement_id: string;
  company_id: string;
  bank_ledger_id: string;
  txn_date: string;
  description: string;
  reference: string;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number | null;
  matched_voucher_id: string | null;
  match_status: "matched" | "suggested" | "unmatched" | "ignored";
  match_score?: number;
}

export interface VoucherCandidate {
  id: string;
  voucher_date: string;
  voucher_number: string;
  reference_no: string | null;
  total_paise: number;
  voucher_type: string;
  party_id?: string | null;
}

function uid(): string {
  return (crypto as any)?.randomUUID?.() ?? `bs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Suggest a match: same amount (±₹1), within ±7 days. Boost on ref/number overlap.
export function suggestMatch(line: ParsedBankLine, candidates: VoucherCandidate[]): { id: string; score: number } | null {
  const target = line.debit_paise > 0 ? line.debit_paise : line.credit_paise;
  if (!target) return null;
  let best: { id: string; score: number } | null = null;
  const lineDate = Date.parse(line.txn_date);
  const desc = line.description.toLowerCase();
  for (const c of candidates) {
    if (Math.abs(c.total_paise - target) > 100) continue; // ±₹1
    const diffDays = Math.abs((Date.parse(c.voucher_date) - lineDate) / 86_400_000);
    if (diffDays > 7) continue;
    let score = 100 - diffDays * 5;
    if (c.total_paise === target) score += 10;
    if (c.reference_no && line.reference && c.reference_no.trim() && line.reference.includes(c.reference_no.trim())) score += 30;
    if (desc.includes(c.voucher_number.toLowerCase())) score += 25;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best;
}

export async function loadVoucherCandidates(companyId: string, bankLedgerId: string): Promise<VoucherCandidate[]> {
  const vs = await readVouchers(companyId);
  // Restrict to vouchers that actually touch the selected bank ledger.
  const entries = await offlineDb.cache_voucher_entries.where("[company_id+ledger_id]").equals([companyId, bankLedgerId]).toArray();
  const relevantIds = new Set(entries.map((e: any) => String(e.voucher_id)));
  return vs
    .filter((v: any) => relevantIds.has(String(v.id)))
    .map((v: any) => ({
      id: String(v.id),
      voucher_date: String(v.voucher_date),
      voucher_number: String(v.voucher_number || ""),
      reference_no: v.reference_no ? String(v.reference_no) : null,
      total_paise: Number(v.total_paise || 0),
      voucher_type: String(v.voucher_type || ""),
      party_id: v.party_id ? String(v.party_id) : null,
    }));
}

export async function commitStatement(
  companyId: string,
  bankLedgerId: string,
  fileName: string,
  parsed: ParsedBankLine[],
  candidates: VoucherCandidate[],
): Promise<{ statementId: string; matched: number; unmatched: number }> {
  const dates = parsed.map((p) => p.txn_date).sort();
  const stmt: LocalBankStatement = {
    id: uid(),
    company_id: companyId,
    bank_ledger_id: bankLedgerId,
    file_name: fileName,
    from_date: dates[0] || "",
    to_date: dates[dates.length - 1] || "",
    total_lines: parsed.length,
    imported_at: new Date().toISOString(),
  };
  const lines: LocalBankLine[] = parsed.map((p) => {
    const m = suggestMatch(p, candidates);
    return {
      id: uid(),
      statement_id: stmt.id,
      company_id: companyId,
      bank_ledger_id: bankLedgerId,
      txn_date: p.txn_date,
      description: p.description,
      reference: p.reference,
      debit_paise: p.debit_paise,
      credit_paise: p.credit_paise,
      balance_paise: p.balance_paise,
      matched_voucher_id: m?.id ?? null,
      match_status: m ? "suggested" : "unmatched",
      match_score: m?.score,
    };
  });
  await offlineDb.cache_bank_statements.put(stmt);
  await offlineDb.cache_bank_statement_lines.bulkPut(lines);
  return {
    statementId: stmt.id,
    matched: lines.filter((l) => l.matched_voucher_id).length,
    unmatched: lines.filter((l) => !l.matched_voucher_id).length,
  };
}

export async function listLines(companyId: string, bankLedgerId: string): Promise<LocalBankLine[]> {
  const rows = await offlineDb.cache_bank_statement_lines
    .where("[company_id+bank_ledger_id+txn_date]")
    .between([companyId, bankLedgerId, ""], [companyId, bankLedgerId, "\uffff"])
    .toArray();
  return (rows as LocalBankLine[]).sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1));
}

export async function updateLine(id: string, patch: Partial<LocalBankLine>): Promise<void> {
  await offlineDb.cache_bank_statement_lines.update(id, patch);
}

export async function deleteStatement(statementId: string): Promise<void> {
  const lines = await offlineDb.cache_bank_statement_lines.where("statement_id").equals(statementId).toArray();
  await offlineDb.cache_bank_statement_lines.bulkDelete(lines.map((l: any) => l.id));
  await offlineDb.cache_bank_statements.delete(statementId);
}
