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
  { id: "2.1", section: "Receivables & customers", question: "What is our total accounts receivable, broken down by aging buckets (0–30, 31–60, 61–90, 90+ days)?", routeIntent: "party_summary", router: "local", tool: "get_party_summary", status: "answered", phase: 1, dataUsed: "Debtor ledgers; sales, receipt, credit note and journal entries; openings; recorded bill allocations.", note: "Per party, largest first, with ageing buckets. Recorded bill allocations are applied first; FIFO covers only unallocated receipts. Advances, credit notes and other unmatched amounts are shown apart. Ageing is by bill date." },
  { id: "2.2", section: "Receivables & customers", question: "Which customers have overdue invoices past their credit limit or credit period?", routeIntent: "credit_watch", router: "local", tool: "get_credit_watch", status: "answered", phase: 1, dataUsed: "Receivable settlement per party (recorded allocations first, FIFO for the rest); credit limit and credit days per ledger.", note: "Flags a customer over its credit limit (where set), or with a bill past its credit days. Credit days are the ledger's own where set; otherwise 30 days, disclosed per row. Opening balances count as overdue." },
  { id: "2.3", section: "Receivables & customers", question: "What is the total outstanding balance and payment history for Ram Traders?", routeIntent: "party_balance", router: "local", tool: "get_party_balance", status: "answered", phase: 1, dataUsed: "Party ledger entries.", note: "Balance from the party ledger; history from the ledger statement." },
  { id: "2.4", section: "Receivables & customers", question: "Which invoices are partially paid, unallocated, or sitting as customer advances?", routeIntent: "unknown", router: "declined", tool: "bill_allocations", status: "planned", phase: 1, dataUsed: "Bill-wise allocations are recorded when a receipt or payment is entered against bills (cache_bill_allocations). Partly paid and unallocated amounts can be derived from them.", note: "Not built yet. The ageing answers still use FIFO for everything; switching them to recorded allocations is the next step under the calculation standards." },
  { id: "2.5", section: "Receivables & customers", question: "Who are our top 10 customers by revenue and by overdue balance this financial year?", routeIntent: "customer_ranking", router: "local", tool: "get_customer_ranking", status: "answered", phase: 1, dataUsed: "Sales vouchers per customer (revenue); receivable ageing per customer (overdue).", note: "Top 10 by sales revenue in the period, and top 10 by balance over 30 days old as on the period end." },

  // 3. Payables and vendors
  { id: "3.1", section: "Payables & vendors", question: "What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?", routeIntent: "unknown", router: "declined", tool: "payables_due", status: "planned", phase: 2, dataUsed: "Payables total (available via the payables side of the party summary). Due dates on purchase bills: not confirmed in the schema.", note: "The total can be answered now; the 7- and 15-day window needs a due date on each bill." },
  { id: "3.2", section: "Payables & vendors", question: "Which vendors have overdue balances or unadjusted debit notes/advances?", routeIntent: "vendor_overdue", router: "local", tool: "get_vendor_overdue", status: "answered", phase: 1, dataUsed: "Payable settlement per vendor (recorded allocations first, FIFO for the rest); credit days per ledger.", note: "Flags a vendor with a payable past its credit days (30 where none is set, disclosed per row), or with an unadjusted advance or debit note. Advances and debit notes are listed separately." },
  { id: "3.3", section: "Payables & vendors", question: "What is the total spend and average payment cycle for ABC Traders over the last 6 months?", routeIntent: "vendor_spend_cycle", router: "local", tool: "get_vendor_spend_cycle", status: "answered", phase: 1, dataUsed: "Purchase bills and payments on the vendor ledger, by date; recorded bill allocations (cache_bill_allocations).", note: "Gross purchases less purchase returns (debit notes) less other debit adjustments gives net purchases, each shown separately. Payment cycle uses recorded bill allocations first; the unallocated part is matched FIFO and disclosed as an estimate. Payments that settled an opening balance are reported, not timed." },
  { id: "3.4", section: "Payables & vendors", question: "Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor?", routeIntent: "duplicate_check", router: "local", tool: "get_duplicate_check", status: "answered", phase: 1, dataUsed: "Bill number (reference) on purchase vouchers, vendor, amount, payment dates and item rates.", note: "Duplicate bill = same vendor and bill number. Repeat payment = same amount to the same vendor within 30 days. Price jump = more than 25% above the vendor's previous rate for the item. Thresholds are defaults and are stated in each answer." },
  { id: "3.5", section: "Payables & vendors", question: "Which vendors account for 80% of our purchase spend this year?", routeIntent: "vendor_concentration", router: "local", tool: "get_vendor_concentration", status: "answered", phase: 1, dataUsed: "Gross purchase bills per vendor in the period.", note: "Vendors ranked by gross purchase spend, listed until the cumulative share reaches 80% (that vendor included). Returns are not deducted." },

  // 4. Sales, purchases and profitability
  { id: "4.1", section: "Sales, purchases & profitability", question: "What is our gross profit, operating profit, and net profit for March compared to the previous period?", routeIntent: "explanation", router: "cannot", tool: "get_profit_loss", status: "planned", phase: 3, dataUsed: "Profit and loss tool exists; closing stock from the year-end closure.", note: "Blocked on the closing-stock decision for net profit. The wording is not routed to the tool yet." },
  { id: "4.2", section: "Sales, purchases & profitability", question: "Which products, services, or cost centres generate the highest margins and which ones are loss-making?", routeIntent: "unknown", router: "declined", tool: "item_margins", status: "planned", phase: 2, dataUsed: "Item-level sales and purchase lines with cost. Cost centres are stored; their link to items is not confirmed.", note: "Margin per item needs item lines on sales and purchase vouchers." },
  { id: "4.3", section: "Sales, purchases & profitability", question: "What is our month-on-month revenue and expense trend for the current financial year?", routeIntent: "monthly_trend", router: "local", tool: "get_monthly_trend", status: "answered", phase: 1, dataUsed: "Sales and expense ledger postings by voucher date.", note: "Revenue = net credit to sales ledgers; expenses = net debit to direct and indirect expense ledgers; by month of voucher date, with month-on-month change. Net is before closing stock." },
  { id: "4.4", section: "Sales, purchases & profitability", question: "Which expense ledgers have exceeded budget or grown significantly compared to last month?", routeIntent: "unknown", router: "declined", tool: "budget_variance", status: "not_in_books", phase: 2, dataUsed: "Missing: budgets per expense ledger. Monthly growth can be computed without them.", note: "Budget comparison needs a budget table first." },
  { id: "4.5", section: "Sales, purchases & profitability", question: "What is our total purchase return or sales return value this quarter, and why did it occur?", routeIntent: "returns_summary", router: "local", tool: "get_returns_summary", status: "answered", phase: 1, dataUsed: "Credit note and debit note vouchers: totals, dates, parties and narration.", note: "Sales returns = credit notes; purchase returns = debit notes. Default period is the current financial-year quarter. The reason is the voucher narration; blank narration is reported as no reason recorded." },

  // 5. Inventory and stock
  { id: "5.1", section: "Inventory & stock", question: "What is the current stock quantity and valuation for Rice Basmati across all godowns?", routeIntent: "item_stock", router: "local", tool: "get_item_stock", status: "partial", phase: 1, dataUsed: "Stock items (opening quantity and rate); stock lines on vouchers (quantity, rate, date).", note: "Quantity and value for one item across all godowns. Value uses the last purchase rate. Godown split needs a godown on stock lines (not recorded), so it is not shown." },
  { id: "5.2", section: "Inventory & stock", question: "Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)?", routeIntent: "stock_movement", router: "local", tool: "get_stock_movement", status: "answered", phase: 1, dataUsed: "Stock movement dates and quantities per item (stock lines on vouchers); opening stock per item.", note: "Items on hand only. Fast = 3+ movements in 30 days; dead = no movement for 90+ days or never moved; slow = last movement 31 to 90 days ago. Thresholds are defaults and are stated in each answer." },
  { id: "5.3", section: "Inventory & stock", question: "Which items are below reorder level and need a purchase order raised?", routeIntent: "stock_reorder", router: "local", tool: "get_stock_reorder", status: "answered", phase: 1, dataUsed: "Reorder level (optional item field); current stock per item.", note: "Items with a reorder level above zero and stock on hand at or below it. Items without a reorder level are not reported." },
  { id: "5.4", section: "Inventory & stock", question: "Are there negative stock balances or valuation mismatches between stock ledgers and financial accounts?", routeIntent: "unknown", router: "declined", tool: "stock_audit", status: "planned", phase: 1, dataUsed: "Stock valuation from items; stock ledger balances.", note: "Block any negative stock; warn above ₹500 or 1% of line stock value, whichever is higher, with a mandatory reason. Thresholds are company-level settings (see sync note)." },
  { id: "5.5", section: "Inventory & stock", question: "What is the impact of stock valuation changes on Cost of Goods Sold (COGS) for this period?", routeIntent: "explanation", router: "cannot", tool: "cogs", status: "planned", phase: 3, dataUsed: "Opening and closing stock; purchases; sales cost.", note: "Blocked on the closing-stock decision." },

  // 6. Tax, statutory and compliance
  { id: "6.1", section: "Tax, statutory & compliance", question: "What is our estimated net GST payable or available Input Tax Credit (ITC) for the current return period?", routeIntent: "explanation", router: "cannot", tool: "gst_summary", status: "planned", phase: 1, dataUsed: "Tax amounts on sales and purchase vouchers. GSTR-1, GSTR-2B, GSTR-3B and GSTR-9 report screens exist.", note: "Chat may show provisional net GST payable only with period, reconciliation status, provisional label, 3B link; refuses when period locked, books incomplete, or mismatch beyond tolerance. Built as the get_gst_provisional_payable chat tool; not yet routed from the question router." },
  { id: "6.2", section: "Tax, statutory & compliance", question: "Are there mismatches between purchase registers/books and inward tax statements (such as GSTR-2B) or sales records?", routeIntent: "unknown", router: "declined", tool: "gstr2b_recon", status: "planned", phase: 1, dataUsed: "GSTR-2B reconciliation code exists (src/lib/gstr2b-recon.ts); the purchase register.", note: "Chat explains and points to rows; blocking only on save and report screens. Checks must never exist only in chat. Not built in chat yet: the reconciliation list runs on the GSTR-2B screen." },
  { id: "6.3", section: "Tax, statutory & compliance", question: "Which transactions lack valid tax registration numbers, HSN/SAC codes, or proper tax invoices?", routeIntent: "unknown", router: "declined", tool: "tax_compliance_check", status: "planned", phase: 1, dataUsed: "GSTIN on parties; HSN on items and voucher lines.", note: "Chat explains and points to rows; blocking only on save and report screens. Checks must never exist only in chat. Advisory rule list (check_book_rules) covers reference and ledger-type rules only; registration and HSN checks are not built." },
  { id: "6.4", section: "Tax, statutory & compliance", question: "How much TDS has been deducted across sections this quarter, and is any challan payment or return filing pending?", routeIntent: "explanation", router: "cannot", tool: "tds_summary", status: "not_in_books", phase: 2, dataUsed: "Missing: TDS section, amount and challan on vouchers. Only TDS ledgers, if kept, can be read today.", note: "Needs TDS fields on vouchers before this can be answered." },
  { id: "6.5", section: "Tax, statutory & compliance", question: "Are there any unadjusted advance receipts or round-off/tax ledger discrepancies before period close?", routeIntent: "unknown", router: "declined", tool: "round_off_check", status: "planned", phase: 1, dataUsed: "Round-off and tax ledger balances; advance receipts from ageing.", note: "Section 170 nearest-rupee rounding is statutory. Per tax head, return line only, never written back to ledger; pre-rounding figure retained and delta shown. Round-off notice and advance-GST notice are built; threshold settings are company-level, sync-dependent (see sync note)." },

  // 7. Ledger hygiene, vouchers and audit readiness
  { id: "7.1", section: "Ledger hygiene & audit readiness", question: "Which journal entries or vouchers were manually posted, backdated, edited, or deleted after period close?", routeIntent: "unknown", router: "declined", tool: "voucher_audit", status: "planned", phase: 2, dataUsed: "Activity log records AI-originated actions and year-end runs (src/lib/ai/audit-log.ts). Manual edits and backdating history are not stored.", note: "Needs a change history on vouchers before edits can be reported." },
  { id: "7.2", section: "Ledger hygiene & audit readiness", question: "Are there any suspense, uncategorised, or miscoded entries sitting in asset, liability, or expense ledgers?", routeIntent: "unknown", router: "declined", tool: "suspense_check", status: "planned", phase: 1, dataUsed: "Ledger names and groups; postings to suspense-type ledgers.", note: "Account-type mapping as agreed: GST output = Liability, ITC = Asset, round-off = P&L, all under a distinct Duties & Taxes group. Audit check built; the mapping is advisory on existing ledgers." },
  { id: "7.3", section: "Ledger hygiene & audit readiness", question: "Which vouchers are missing narration, supporting references, or proper cost-centre tags?", routeIntent: "unknown", router: "declined", tool: "voucher_hygiene", status: "planned", phase: 1, dataUsed: "Narration, reference number and cost-centre fields on vouchers.", note: "Reference-number enforcement on save: sales, purchase, credit note, debit note and journal need a document reference; bank payment/receipt need an instrument reference. Cost-centre rule applies where the line form supports it; not yet enforced because the item and entry forms have no line-level cost-centre field. Backlog: add cost-centre field to item line and entry form, then enable cost-centre enforcement." },
  { id: "7.4", section: "Ledger hygiene & audit readiness", question: "Do Trial Balance, Balance Sheet, and Profit & Loss totals reconcile cleanly with zero unexplained differences?", routeIntent: "unknown", router: "declined", tool: "get_trial_balance", status: "planned", phase: 1, dataUsed: "Trial balance engine; balance sheet and profit and loss totals.", note: "The trial balance tool exists; this wording is not routed to it yet. Balance sheet and profit and loss checks are planned." },
  { id: "7.5", section: "Ledger hygiene & audit readiness", question: "Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)?", routeIntent: "abnormal_balances", router: "local", tool: "get_abnormal_balances", status: "answered", phase: 1, dataUsed: "Ledger group and closing balance per ledger.", note: "Ledger closing side opposite to its normal side. Duties and taxes are not checked; a bank in overdraft shows as abnormal." },
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
