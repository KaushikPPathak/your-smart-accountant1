// 7.2: ledger name vs account type. GST output is a liability and ITC is an asset, both in
// Duties & Taxes, and round-off belongs in P&L. A ledger whose name says one of these but whose
// type is elsewhere misstates the balance sheet and the GST return. Rules are name-based and
// deliberately narrow: a name that matches no rule is never flagged.

export interface LedgerTypeRule {
  label: string;
  pattern: RegExp;
  /** Accepted ledger types. An empty list means the ledger must be reclassified. */
  accepted: string[];
}

export const LEDGER_TYPE_RULES: LedgerTypeRule[] = [
  { label: "GST output", pattern: /\boutput\s+(cgst|sgst|igst|cess|gst)\b/i, accepted: ["duties_taxes"] },
  { label: "GST input (ITC)", pattern: /\binput\s+(cgst|sgst|igst|cess|gst)\b|\bitc\b/i, accepted: ["duties_taxes", "current_asset"] },
  { label: "Reverse charge", pattern: /\b(reverse\s+charge|rcm)\b/i, accepted: ["duties_taxes", "current_asset"] },
  { label: "Round-off", pattern: /\bround\s*-?\s*off\b/i, accepted: ["income_indirect", "expense_indirect"] },
  { label: "Depreciation", pattern: /\bdepreciation\b/i, accepted: ["expense_indirect"] },
  { label: "TDS", pattern: /\btds\s+(receivable|payable)\b/i, accepted: ["duties_taxes", "current_asset", "current_liability"] },
  { label: "Stock", pattern: /\b(stock\s+in\s+hand|closing\s+stock|opening\s+stock)\b/i, accepted: ["stock_in_hand"] },
  { label: "Suspense", pattern: /\bsuspense\b/i, accepted: [] },
];

export interface LedgerTypeMismatch {
  id: string;
  name: string;
  type: string;
  rule: string;
  accepted: string[];
}

export function ledgerTypeMismatches(ledgers: { id: string; name: string; type: string }[]): LedgerTypeMismatch[] {
  const out: LedgerTypeMismatch[] = [];
  for (const l of ledgers) {
    const rule = LEDGER_TYPE_RULES.find((r) => r.pattern.test(l.name));
    if (!rule) continue;
    if (rule.accepted.includes(l.type)) continue;
    out.push({ id: l.id, name: l.name, type: l.type, rule: rule.label, accepted: rule.accepted });
  }
  return out;
}
