// Architecture of the accounting questionnaire: every question, the intent the router gives it,
// the function that will answer it, the data it needs, and where it stands.
//
// status
//   answered      a local function answers it fully
//   partial       a local function answers part of it; the note says what is missing
//   planned       the books hold the data (or it is a known gap); the function is not built
//   not_in_books  the app does not store the data this needs (see dataUsed)
//
// phase (the order the work can be taken in)
//   1  the books already hold the data; build the function locally
//   2  the app needs a new field, record or capture before this can be answered reliably
//   3  outside the books, or blocked on a decision; not planned for chat yet
//
// router (what the chat does today for this exact wording)
//   local     answered from the books without a model
//   declined  the router says plainly it cannot produce the report
//   cannot    routed to the model path, which the chat does not call; the user sees "cannot answer yet"
//
// question-catalog.test.ts checks every entry against the real router and the real tool list.

export type QuestionStatus = "answered" | "partial" | "planned" | "not_in_books";
export type RouterOutcome = "local" | "declined" | "cannot";
export type Phase = 1 | 2 | 3;

export interface CatalogQuestion {
  id: string;
  section: string;
  question: string;
  /** Intent the router returns for this exact wording. */
  routeIntent: string;
  router: RouterOutcome;
  /** Function that answers it: an existing tool name, or the planned name. */
  tool: string;
  status: QuestionStatus;
  phase: Phase;
  /** The stored data the answer uses, or the data that is missing. */
  dataUsed: string;
  note: string;
}

export const QUESTION_CATALOG: CatalogQuestion[] = [
  // 1. Cash, bank and liquidity
  { id: "1.1", section: "Cash, bank & liquidity", question: "What is our current cash and bank balance across all accounts as of today?", routeIntent: "cash_bank_total", router: "local", tool: "get_cash_bank_total", status: "answered", phase: 1, dataUsed: "Ledgers in cash and bank groups; openings; voucher entries.", note: "Signed sum of all cash and bank ledgers as of the latest posting." },
  { id: "1.2", section: "Cash, bank & liquidity", question: "Are there any cheques issued or received that are still uncleared or bouncing?", routeIntent: "unknown", router: "declined", tool: "cheque_status", status: "not_in_books", phase: 2, dataUsed: "Missing: cheque number, cheque date and clearing date on receipt and payment vouchers.", note: "Not stored as fields today." },
  { id: "1.3", section: "Cash, bank & liquidity", question: "What is the difference between our bank statement balance and book balance for HDFC this month?", routeIntent: "unknown", router: "declined", tool: "reconcile_bank", status: "planned", phase: 2, dataUsed: "Bank statement lines. A statement parser exists (src/lib/statement-parse.ts); whether its lines are stored is not confirmed.", note: "Needs the statement lines kept per account before a reconciliation can be answered." },
  { id: "1.4", section: "Cash, bank & liquidity", question: "Which bank or cash ledger has seen unusual spikes or out-of-pattern withdrawals recently?", routeIntent: "bank_anomalies", router: "local", tool: "get_bank_anomalies", status: "answered", phase: 1, dataUsed: "Voucher entries per bank and cash ledger, by month.", note: "Flags a latest month whose outflow is at least 2× the earlier monthly average and at least ₹10,000." },
  { id: "1.5", section: "Cash, bank & liquidity", question: "How many days of operating runway do we have based on current cash and average monthly burn?", routeIntent: "cash_runway", router: "local", tool: "get_cash_runway", status: "answered", phase: 1, dataUsed: "Cash and bank total by date (answered); voucher dates.", note: "Burn = fall in cash and bank over the three full months before the latest posting, ÷ 3. Runway = current position ÷ (burn ÷ 30). Says so when cash is not falling, is exhausted, or history is short." },

  // 2. Receivables and customers
  { id: "2.1", section: "Receivables & customers", question: "What is our total accounts receivable, broken down by aging buckets (0–30, 31–60, 61–90, 90+ days)?", routeIntent: "party_summary", router: "local", tool: "get_party_summary", status: "answered", phase: 1, dataUsed: "Debtor ledgers; sales and receipt entries; openings.", note: "Per party, largest first, with ageing buckets. Oldest bill settled first." },
  { id: "2.2", section: "Receivables & customers", question: "Which customers have overdue invoices past their credit limit or credit period?", routeIntent: "credit_watch", router: "local", tool: "get_credit_watch", status: "answered", phase: 1, dataUsed: "Receivable ageing per party; credit limit per ledger (optional). Credit days on the ledger are not used yet.", note: "Flags a customer whose balance is above its credit limit (where set), or who has any balance over 30 days old. Opening balances count as overdue." },
  { id: "2.3", section: "Receivables & customers", question: "What is the total outstanding balance and payment history for Ram Traders?", routeIntent: "party_balance", router: "local", tool: "get_party_balance", status: "answered", phase: 1, dataUsed: "Party ledger entries.", note: "Balance from the party ledger; history from the ledger statement." },
  { id: "2.4", section: "Receivables & customers", question: "Which invoices are partially paid, unallocated, or sitting as customer advances?", routeIntent: "unknown", router: "declined", tool: "bill_allocations", status: "planned", phase: 2, dataUsed: "Ageing allocates receipts to bills oldest first; the allocation itself is not stored per bill.", note: "Needs stored bill-wise allocations to report which invoice a receipt paid." },
  { id: "2.5", section: "Receivables & customers", question: "Who are our top 10 customers by revenue and by overdue balance this financial year?", routeIntent: "unknown", router: "declined", tool: "party_ranking", status: "planned", phase: 1, dataUsed: "Receivable ageing per party (overdue); sales vouchers per party (revenue).", note: "Overdue ranking reuses the receivables summary; revenue ranking needs sales totals per party." },

  // 3. Payables and vendors
  { id: "3.1", section: "Payables & vendors", question: "What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?", routeIntent: "unknown", router: "declined", tool: "payables_due", status: "planned", phase: 2, dataUsed: "Payables total (available via the payables side of the party summary). Due dates on purchase bills: not confirmed in the schema.", note: "The total can be answered now; the 7- and 15-day window needs a due date on each bill." },
  { id: "3.2", section: "Payables & vendors", question: "Which vendors have overdue balances or unadjusted debit notes/advances?", routeIntent: "unknown", router: "declined", tool: "vendor_overdue", status: "planned", phase: 1, dataUsed: "Payable ageing; debit-note vouchers, if the voucher types include them.", note: "Overdue part reuses the payables summary." },
  { id: "3.3", section: "Payables & vendors", question: "What is the total spend and average payment cycle for ABC Traders over the last 6 months?", routeIntent: "explanation", router: "cannot", tool: "vendor_spend", status: "planned", phase: 1, dataUsed: "Purchase and payment vouchers per vendor, by date.", note: "Payment cycle is the gap between purchase and payment, per bill." },
  { id: "3.4", section: "Payables & vendors", question: "Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor?", routeIntent: "unknown", router: "declined", tool: "duplicate_check", status: "planned", phase: 1, dataUsed: "Voucher number, party, amount and item rate on purchase vouchers.", note: "Price-jump threshold needs a definition." },
  { id: "3.5", section: "Payables & vendors", question: "Which vendors account for 80% of our purchase spend this year?", routeIntent: "unknown", router: "declined", tool: "vendor_concentration", status: "planned", phase: 1, dataUsed: "Purchase totals per vendor.", note: "Cumulative share ranking." },

  // 4. Sales, purchases and profitability
  { id: "4.1", section: "Sales, purchases & profitability", question: "What is our gross profit, operating profit, and net profit for March compared to the previous period?", routeIntent: "explanation", router: "cannot", tool: "get_profit_loss", status: "planned", phase: 3, dataUsed: "Profit and loss tool exists; closing stock from the year-end closure.", note: "Blocked on the closing-stock decision for net profit. The wording is not routed to the tool yet." },
  { id: "4.2", section: "Sales, purchases & profitability", question: "Which products, services, or cost centres generate the highest margins and which ones are loss-making?", routeIntent: "unknown", router: "declined", tool: "item_margins", status: "planned", phase: 2, dataUsed: "Item-level sales and purchase lines with cost. Cost centres are stored; their link to items is not confirmed.", note: "Margin per item needs item lines on sales and purchase vouchers." },
  { id: "4.3", section: "Sales, purchases & profitability", question: "What is our month-on-month revenue and expense trend for the current financial year?", routeIntent: "explanation", router: "cannot", tool: "monthly_trend", status: "planned", phase: 1, dataUsed: "Sales and expense postings by voucher date.", note: "Monthly groups of the same postings the sales total uses." },
  { id: "4.4", section: "Sales, purchases & profitability", question: "Which expense ledgers have exceeded budget or grown significantly compared to last month?", routeIntent: "unknown", router: "declined", tool: "budget_variance", status: "not_in_books", phase: 2, dataUsed: "Missing: budgets per expense ledger. Monthly growth can be computed without them.", note: "Budget comparison needs a budget table first." },
  { id: "4.5", section: "Sales, purchases & profitability", question: "What is our total purchase return or sales return value this quarter, and why did it occur?", routeIntent: "explanation", router: "cannot", tool: "returns_summary", status: "planned", phase: 1, dataUsed: "Return vouchers and their totals; narration for the reason.", note: "The reason is only as good as the narration entered." },

  // 5. Inventory and stock
  { id: "5.1", section: "Inventory & stock", question: "What is the current stock quantity and valuation for Rice Basmati across all godowns?", routeIntent: "explanation", router: "cannot", tool: "get_stock_summary", status: "planned", phase: 1, dataUsed: "Stock items, godowns, closing stock valuation. The stock summary tool exists.", note: "Wording is not routed to the tool yet." },
  { id: "5.2", section: "Inventory & stock", question: "Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)?", routeIntent: "unknown", router: "declined", tool: "stock_movement", status: "planned", phase: 1, dataUsed: "Stock movement dates per item.", note: "Thresholds (fast, slow, dead) need agreeing." },
  { id: "5.3", section: "Inventory & stock", question: "Which items are below reorder level and need a purchase order raised?", routeIntent: "unknown", router: "declined", tool: "stock_reorder", status: "planned", phase: 1, dataUsed: "Reorder level (optional item field); current stock per item.", note: "Items without a reorder level are not reported." },
  { id: "5.4", section: "Inventory & stock", question: "Are there negative stock balances or valuation mismatches between stock ledgers and financial accounts?", routeIntent: "unknown", router: "declined", tool: "stock_audit", status: "planned", phase: 1, dataUsed: "Stock valuation from items; stock ledger balances.", note: "Mismatch tolerance needs agreeing." },
  { id: "5.5", section: "Inventory & stock", question: "What is the impact of stock valuation changes on Cost of Goods Sold (COGS) for this period?", routeIntent: "explanation", router: "cannot", tool: "cogs", status: "planned", phase: 3, dataUsed: "Opening and closing stock; purchases; sales cost.", note: "Blocked on the closing-stock decision." },

  // 6. Tax, statutory and compliance
  { id: "6.1", section: "Tax, statutory & compliance", question: "What is our estimated net GST payable or available Input Tax Credit (ITC) for the current return period?", routeIntent: "explanation", router: "cannot", tool: "gst_summary", status: "planned", phase: 1, dataUsed: "Tax amounts on sales and purchase vouchers. GSTR-1, GSTR-2B, GSTR-3B and GSTR-9 report screens exist.", note: "The chat's GST route (gst_query) feeds the model path, which the chat does not call, so no local answer yet." },
  { id: "6.2", section: "Tax, statutory & compliance", question: "Are there mismatches between purchase registers/books and inward tax statements (such as GSTR-2B) or sales records?", routeIntent: "unknown", router: "declined", tool: "gstr2b_recon", status: "planned", phase: 1, dataUsed: "GSTR-2B reconciliation code exists (src/lib/gstr2b-recon.ts); the purchase register.", note: "The reconciliation runs in the app screens, not in chat." },
  { id: "6.3", section: "Tax, statutory & compliance", question: "Which transactions lack valid tax registration numbers, HSN/SAC codes, or proper tax invoices?", routeIntent: "unknown", router: "declined", tool: "tax_compliance_check", status: "planned", phase: 1, dataUsed: "GSTIN on parties; HSN on items and voucher lines.", note: "Validity means present and well-formed, not verified with the tax authority." },
  { id: "6.4", section: "Tax, statutory & compliance", question: "How much TDS has been deducted across sections this quarter, and is any challan payment or return filing pending?", routeIntent: "explanation", router: "cannot", tool: "tds_summary", status: "not_in_books", phase: 2, dataUsed: "Missing: TDS section, amount and challan on vouchers. Only TDS ledgers, if kept, can be read today.", note: "Needs TDS fields on vouchers before this can be answered." },
  { id: "6.5", section: "Tax, statutory & compliance", question: "Are there any unadjusted advance receipts or round-off/tax ledger discrepancies before period close?", routeIntent: "unknown", router: "declined", tool: "round_off_check", status: "planned", phase: 1, dataUsed: "Round-off and tax ledger balances; advance receipts from ageing.", note: "Discrepancy threshold needs agreeing." },

  // 7. Ledger hygiene, vouchers and audit readiness
  { id: "7.1", section: "Ledger hygiene & audit readiness", question: "Which journal entries or vouchers were manually posted, backdated, edited, or deleted after period close?", routeIntent: "unknown", router: "declined", tool: "voucher_audit", status: "planned", phase: 2, dataUsed: "Activity log records AI-originated actions and year-end runs (src/lib/ai/audit-log.ts). Manual edits and backdating history are not stored.", note: "Needs a change history on vouchers before edits can be reported." },
  { id: "7.2", section: "Ledger hygiene & audit readiness", question: "Are there any suspense, uncategorised, or miscoded entries sitting in asset, liability, or expense ledgers?", routeIntent: "unknown", router: "declined", tool: "suspense_check", status: "planned", phase: 1, dataUsed: "Ledger names and groups; postings to suspense-type ledgers.", note: "Miscoding beyond suspense ledgers needs an account-type rule per ledger." },
  { id: "7.3", section: "Ledger hygiene & audit readiness", question: "Which vouchers are missing narration, supporting references, or proper cost-centre tags?", routeIntent: "unknown", router: "declined", tool: "voucher_hygiene", status: "planned", phase: 1, dataUsed: "Narration, reference number and cost-centre fields on vouchers.", note: "Which vouchers need a reference is a rule to agree." },
  { id: "7.4", section: "Ledger hygiene & audit readiness", question: "Do Trial Balance, Balance Sheet, and Profit & Loss totals reconcile cleanly with zero unexplained differences?", routeIntent: "unknown", router: "declined", tool: "get_trial_balance", status: "planned", phase: 1, dataUsed: "Trial balance engine; balance sheet and profit and loss totals.", note: "The trial balance tool exists; this wording is not routed to it yet. Balance sheet and profit and loss checks are planned." },
  { id: "7.5", section: "Ledger hygiene & audit readiness", question: "Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)?", routeIntent: "unknown", router: "declined", tool: "abnormal_balances", status: "planned", phase: 1, dataUsed: "Ledger group and closing balance per ledger.", note: "Expected sign per group needs a table." },
];

export function catalogSummary(): Record<QuestionStatus, number> {
  const out: Record<QuestionStatus, number> = { answered: 0, partial: 0, planned: 0, not_in_books: 0 };
  for (const q of QUESTION_CATALOG) out[q.status]++;
  return out;
}

export function phaseSummary(): Record<Phase, number> {
  const out: Record<Phase, number> = { 1: 0, 2: 0, 3: 0 };
  for (const q of QUESTION_CATALOG) out[q.phase]++;
  return out;
}

/** Markdown for docs/questionnaire-architecture.md. The test fails if the committed file drifts. */
export function renderCatalogueMarkdown(): string {
  const s = catalogSummary();
  const p = phaseSummary();
  const lines: string[] = [
    "# Accounting questionnaire: architecture",
    "",
    "Generated from `src/lib/ai/question-catalog.ts`. Edit the catalogue, then regenerate this file.",
    "",
    `Status: ${s.answered} answered, ${s.partial} partial, ${s.planned} planned, ${s.not_in_books} not in the books.`,
    `Build phase: ${p[1]} buildable from stored data (phase 1), ${p[2]} need new fields or capture (phase 2), ${p[3]} blocked on a decision or outside the books (phase 3).`,
    "",
    "Phases: 1 = the books already hold the data; 2 = the app needs a new field, record or capture first; 3 = blocked on a decision or outside the books.",
    "",
  ];
  let section = "";
  for (const q of QUESTION_CATALOG) {
    if (q.section !== section) {
      section = q.section;
      lines.push(`## ${section}`, "", "| # | Question | Router | Tool | Status | Phase | Data | Note |", "|---|---|---|---|---|---|---|---|");
    }
    const cell = (t: string) => t.replace(/\|/g, "\\|");
    lines.push(
      `| ${q.id} | ${cell(q.question)} | ${q.router} | \`${q.tool}\` | ${q.status} | ${q.phase} | ${cell(q.dataUsed)} | ${cell(q.note)} |`,
    );
    const next = QUESTION_CATALOG[QUESTION_CATALOG.indexOf(q) + 1];
    if (!next || next.section !== section) lines.push("");
  }
  return lines.join("\n");
}
