// src/lib/offline/consistency.ts
//
// Ultimate "Accounting Loopholes" fix: verifies that the sum of all voucher 
// line items (cache_voucher_entries) matches the aggregate Ledger balance.
//
// Designed to run once a week in the background (idle time) or manually 
// from the Data Health screen. Reports discrepancies to the audit log 
// and triggers a high-visibility badge if data drift is detected.

import { offlineDb } from "./db";
import { getMeta, setMeta } from "./db";

export interface ConsistencyIssue {
  ledger_id: string;
  ledger_name: string;
  expected_balance_paise: number;
  actual_entries_sum_paise: number;
  diff_paise: number;
}

export interface ConsistencyReport {
  company_id: string;
  timestamp: string;
  issues: ConsistencyIssue[];
  is_healthy: boolean;
}

/**
 * Verifies ledger balances against entry sums.
 * Ledger balances are usually cached for speed, but they must match the sum of parts.
 */
export async function runConsistencyCheck(companyId: string): Promise<ConsistencyReport> {
  // 1) Load all ledgers for this company
  const ledgers = await offlineDb.cache_ledgers
    .where("company_id")
    .equals(companyId)
    .toArray();
  
  // 2) Load all entries for this company
  const entries = await offlineDb.cache_voucher_entries
    .where("company_id")
    .equals(companyId)
    .toArray();

  const ledgerMap = new Map<string, { name: string; balance: number }>();
  for (const l of ledgers) {
    if (l.is_deleted) continue;
    ledgerMap.set(l.id, { 
      name: l.name, 
      balance: (l.opening_balance_paise ?? 0) // We'll add entries to this
    });
  }

  // Calculate sum of entries per ledger
  const entrySums = new Map<string, number>();
  for (const e of entries) {
    const current = entrySums.get(e.ledger_id) ?? 0;
    const net = (e.debit_paise ?? 0) - (e.credit_paise ?? 0);
    entrySums.set(e.ledger_id, current + net);
  }

  const issues: ConsistencyIssue[] = [];
  
  // 3) Compare!
  // Note: Some systems store a "current_balance" on the ledger row.
  // If we have one, we compare against entrySums + opening_balance.
  for (const [ledgerId, info] of ledgerMap.entries()) {
    const sum = entrySums.get(ledgerId) ?? 0;
    const totalActual = sum + (ledgers.find(l => l.id === ledgerId)?.opening_balance_paise ?? 0);
    
    // In our architecture, the "Source of Truth" for balance should be the sum of entries.
    // If the ledger row has a cached 'balance_paise' (used for reports), it MUST match.
    const cachedBalance = (ledgers.find(l => l.id === ledgerId) as any)?.balance_paise;
    
    if (cachedBalance !== undefined && cachedBalance !== totalActual) {
      issues.push({
        ledger_id: ledgerId,
        ledger_name: info.name,
        expected_balance_paise: cachedBalance,
        actual_entries_sum_paise: totalActual,
        diff_paise: Math.abs(cachedBalance - totalActual),
      });
    }
  }

  const report: ConsistencyReport = {
    company_id: companyId,
    timestamp: new Date().toISOString(),
    issues,
    is_healthy: issues.length === 0,
  };

  // Record the check in meta
  await setMeta(`consistency_report:${companyId}`, report);
  await setMeta(`last_consistency_check:${companyId}`, Date.now());

  if (!report.is_healthy) {
    console.error(`[Consistency] Data drift detected for company ${companyId}:`, issues);
    // Dispatch event for UI badges
    window.dispatchEvent(new CustomEvent("ym:consistency-alert", { detail: report }));
  }

  return report;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Schedules the weekly check. Only runs if 7 days have passed since the last one.
 */
export async function scheduleWeeklyConsistencyCheck(companyId: string) {
  if (!companyId) return;

  const lastCheck = await getMeta<number>(`last_consistency_check:${companyId}`);
  const now = Date.now();

  if (!lastCheck || now - lastCheck > WEEK_MS) {
    // Run in idle time
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as any).requestIdleCallback(() => runConsistencyCheck(companyId), { timeout: 30000 });
    } else {
      setTimeout(() => runConsistencyCheck(companyId), 5000);
    }
  }
}
