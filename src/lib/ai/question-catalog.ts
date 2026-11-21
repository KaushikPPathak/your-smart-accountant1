// Architecture of the accounting questionnaire: every question, the intent the router gives it,
// the function that will answer it, and where that stands.
//
// status
//   answered     a local function answers it fully
//   partial      a local function answers part of it; the note says what is missing
//   planned      the books hold the data; the function is not built yet
//   not_in_books the app does not store the data this needs (see note)
//
// router (what the chat does today): local | declined | cannot
//   local     answered from the books without a model
//   declined  the router says plainly it cannot produce the report
//   cannot    routed to the model path, which the chat does not call; the user sees "cannot answer yet"
//
// The test in question-catalog.test.ts checks every entry against the real router.

export type QuestionStatus = "answered" | "partial" | "planned" | "not_in_books";
export type RouterOutcome = "local" | "declined" | "cannot";

export interface CatalogQuestion {
  id: string;
  section: string;
  question: string;
  /** Intent the router returns for this exact wording. */
  routeIntent: string;
  router: RouterOutcome;
  /** Function that answers it (existing tool name, or the planned name). */
  tool: string | null;
  status: QuestionStatus;
  note: string;
}

export const QUESTION_CATALOG: CatalogQuestion[] = [
  // 1. Cash, bank and liquidity
  { id: "1.1", section: "Cash, bank & liquidity", question: "What is our current cash and bank balance across all accounts as of today?", routeIntent: "cash_bank_total", router: "local", tool: "get_cash_bank_total", status: "answered", note: "Signed sum of all cash and bank ledgers as of the latest posting." },
  { id: "1.2", section: "Cash, bank & liquidity", question: "Are there any cheques issued or received that are still uncleared or bouncing?", routeIntent: "unknown", router: "declined", tool: null, status: "not_in_books", note: "Cheque numbers and clearing dates are not stored as fields." },
  { id: "1.3", section: "Cash, bank & liquidity", question: "What is the difference between our bank statement balance and book balance for HDFC this month?", routeIntent: "unknown", router: "declined", tool: "reconcile_bank", status: "planned", note: "Needs the imported bank statement lines; the bank import exists in the app." },
  { id: "1.4", section: "Cash, bank & liquidity", question: "Which bank or cash ledger has seen unusual spikes or out-of-pattern withdrawals recently?", routeIntent: "unknown", router: "declined", tool: "bank_anomalies", status: "planned", note: "Needs a per-ledger baseline from past postings." },
  { id: "1.5", section: "Cash, bank & liquidity", question: "How many days of operating runway do we have based on current cash and average monthly burn?", routeIntent: "explanation", router: "cannot", tool: "cash_runway", status: "planned", note: "Needs cash (answered) and average monthly payments from the books." },

  // 2. Receivables and customers
  { id: "2.1", section: "Receivables & customers", question: "What is our total accounts receivable, broken down by aging buckets (0–30, 31–60, 61–90, 90+ days)?", routeIntent: "party_summary", router: "local", tool: "get_party_summary", status: "answered", note: "Per party, largest first, with ageing buckets. Oldest bill settled first." },
  { id: "2.2", section: "Receivables & customers", question: "Which customers have overdue invoices past their credit limit or credit period?", routeIntent: "unknown", router: "declined", tool: "credit_limit_check", status: "planned", note: "Credit limits are stored on ledgers; overdue comes from the ageing." },
  { id: "2.3", section: "Receivables & customers", question: "What is the total outstanding balance and payment history for Ram Traders?", routeIntent: "party_balance", router: "local", tool: "get_party_balance", status: "answered", note: "Balance and the party ledger. Use the ledger for history." },
  { id: "2.4", section: "Receivables & customers", question: "Which invoices are partially paid, unallocated, or sitting as customer advances?", routeIntent: "unknown", router: "declined", tool: "bill_allocations", status: "planned", note: "Needs bill-wise allocation. Ageing already allocates oldest first." },
  { id: "2.5", section: "Receivables & customers", question: "Who are our top 10 customers by revenue and by overdue balance this financial year?", routeIntent: "unknown", router: "declined", tool: "party_ranking", status: "planned", note: "Overdue ranking can reuse the receivables summary. Revenue ranking needs sales totals per party." },

  // 3. Payables and vendors
  { id: "3.1", section: "Payables & vendors", question: "What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days?", routeIntent: "unknown", router: "declined", tool: "get_party_summary", status: "planned", note: "Totals exist (payables summary). The 7/15-day window needs bill due dates." },
  { id: "3.2", section: "Payables & vendors", question: "Which vendors have overdue balances or unadjusted debit notes/advances?", routeIntent: "unknown", router: "declined", tool: "vendor_overdue", status: "planned", note: "Overdue part can reuse the payables summary. Debit notes need the return voucher type." },
  { id: "3.3", section: "Payables & vendors", question: "What is the total spend and average payment cycle for ABC Traders over the last 6 months?", routeIntent: "explanation", router: "cannot", tool: "vendor_spend", status: "planned", note: "Purchases and payments per vendor are in the books." },
  { id: "3.4", section: "Payables & vendors", question: "Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor?", routeIntent: "unknown", router: "declined", tool: "duplicate_check", status: "planned", note: "Uses bill numbers, amounts and item rates from vouchers." },
  { id: "3.5", section: "Payables & vendors", question: "Which vendors account for 80% of our purchase spend this year?", routeIntent: "unknown", router: "declined", tool: "vendor_concentration", status: "planned", note: "Needs purchase totals per vendor." },

  // 4. Sales, purchases and profitability
  { id: "4.1", section: "Sales, purchases & profitability", question: "What is our gross profit, operating profit, and net profit for March compared to the previous period?", routeIntent: "explanation", router: "cannot", tool: "get_profit_loss", status: "planned", note: "The tool exists but is not answered locally yet. Needs your closing-stock decision." },
  { id: "4.2", section: "Sales, purchases & profitability", question: "Which products, services, or cost centres generate the highest margins and which ones are loss-making?", routeIntent: "unknown", router: "declined", tool: "item_margins", status: "planned", note: "Needs sales and cost per item; cost centres are stored." },
  { id: "4.3", section: "Sales, purchases & profitability", question: "What is our month-on-month revenue and expense trend for the current financial year?", routeIntent: "explanation", router: "cannot", tool: "monthly_trend", status: "planned", note: "Groups sales and expense postings by month." },
  { id: "4.4", section: "Sales, purchases & profitability", question: "Which expense ledgers have exceeded budget or grown significantly compared to last month?", routeIntent: "unknown", router: "declined", tool: "budget_variance", status: "not_in_books", note: "Budgets are not stored. Growth against last month can be planned." },
  { id: "4.5", section: "Sales, purchases & profitability", question: "What is our total purchase return or sales return value this quarter, and why did it occur?", routeIntent: "explanation", router: "cannot", tool: "returns_summary", status: "planned", note: "Totals from return vouchers. The reason needs the narration." },

  // 5. Inventory and stock
  { id: "5.1", section: "Inventory & stock", question: "What is the current stock quantity and valuation for Rice Basmati across all godowns?", routeIntent: "explanation", router: "cannot", tool: "get_stock_summary", status: "planned", note: "Stock summary tool exists; this wording is not answered locally yet." },
  { id: "5.2", section: "Inventory & stock", question: "Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)?", routeIntent: "unknown", router: "declined", tool: "stock_movement", status: "planned", note: "Uses stock movement dates per item." },
  { id: "5.3", section: "Inventory & stock", question: "Which items are below reorder level and need a purchase order raised?", routeIntent: "unknown", router: "declined", tool: "stock_reorder", status: "planned", note: "Reorder levels are stored on items; needs current stock." },
  { id: "5.4", section: "Inventory & stock", question: "Are there negative stock balances or valuation mismatches between stock ledgers and financial accounts?", routeIntent: "unknown", router: "declined", tool: "stock_audit", status: "planned", note: "Compares stock valuation with the stock ledger balances." },
  { id: "5.5", section: "Inventory & stock", question: "What is the impact of stock valuation changes on Cost of Goods Sold (COGS) for this period?", routeIntent: "explanation", router: "cannot", tool: "cogs", status: "planned", note: "Needs your closing-stock decision." },

  // 6. Tax, statutory and compliance
  { id: "6.1", section: "Tax, statutory & compliance", question: "What is our estimated net GST payable or available Input Tax Credit (ITC) for the current return period?", routeIntent: "explanation", router: "cannot", tool: "gst_summary", status: "planned", note: "GSTR-1, GSTR-3B and GSTR-2B reports exist in the app screens, not in chat." },
  { id: "6.2", section: "Tax, statutory & compliance", question: "Are there mismatches between purchase registers/books and inward tax statements (such as GSTR-2B) or sales records?", routeIntent: "unknown", router: "declined", tool: "gstr2b_recon", status: "planned", note: "The reconciliation exists in the app screens; not in chat yet." },
  { id: "6.3", section: "Tax, statutory & compliance", question: "Which transactions lack valid tax registration numbers, HSN/SAC codes, or proper tax invoices?", routeIntent: "unknown", router: "declined", tool: "tax_compliance_check", status: "planned", note: "GSTIN and HSN fields exist on parties and items." },
  { id: "6.4", section: "Tax, statutory & compliance", question: "How much TDS has been deducted across sections this quarter, and is any challan payment or return filing pending?", routeIntent: "explanation", router: "cannot", tool: "tds_summary", status: "not_in_books", note: "No TDS fields are stored. Only TDS ledgers, if you keep them, can be read." },
  { id: "6.5", section: "Tax, statutory & compliance", question: "Are there any unadjusted advance receipts or round-off/tax ledger discrepancies before period close?", routeIntent: "unknown", router: "declined", tool: "round_off_check", status: "planned", note: "Round-off and tax ledgers are in the books." },

  // 7. Ledger hygiene, vouchers and audit readiness
  { id: "7.1", section: "Ledger hygiene & audit readiness", question: "Which journal entries or vouchers were manually posted, backdated, edited, or deleted after period close?", routeIntent: "unknown", router: "declined", tool: "voucher_audit", status: "planned", note: "Deleted vouchers are flagged. Backdating can use created time. Edit history is not stored." },
  { id: "7.2", section: "Ledger hygiene & audit readiness", question: "Are there any suspense, uncategorised, or miscoded entries sitting in asset, liability, or expense ledgers?", routeIntent: "unknown", router: "declined", tool: "suspense_check", status: "planned", note: "Finds suspense-type ledgers and postings to them." },
  { id: "7.3", section: "Ledger hygiene & audit readiness", question: "Which vouchers are missing narration, supporting references, or proper cost-centre tags?", routeIntent: "unknown", router: "declined", tool: "voucher_hygiene", status: "planned", note: "Narration, reference number and cost-centre fields are stored." },
  { id: "7.4", section: "Ledger hygiene & audit readiness", question: "Do Trial Balance, Balance Sheet, and Profit & Loss totals reconcile cleanly with zero unexplained differences?", routeIntent: "unknown", router: "declined", tool: "get_trial_balance", status: "planned", note: "Trial balance exists, but this wording is not routed to it yet. Balance sheet and profit and loss reconciliation are planned." },
  { id: "7.5", section: "Ledger hygiene & audit readiness", question: "Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)?", routeIntent: "unknown", router: "declined", tool: "abnormal_balances", status: "planned", note: "Can be built from the trial balance and ledger groups." },
];

export function catalogSummary(): Record<QuestionStatus, number> {
  const out: Record<QuestionStatus, number> = { answered: 0, partial: 0, planned: 0, not_in_books: 0 };
  for (const q of QUESTION_CATALOG) out[q.status]++;
  return out;
}
