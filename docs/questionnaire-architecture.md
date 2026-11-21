# Accounting questionnaire: architecture

Generated from `src/lib/ai/question-catalog.ts`. Edit the catalogue, then regenerate this file.

Status: 16 answered, 1 partial, 15 planned, 3 not in the books.
Build phase: 26 buildable from stored data (phase 1), 7 need new fields or capture (phase 2), 2 blocked on a decision or outside the books (phase 3).

Phases: 1 = the books already hold the data; 2 = the app needs a new field, record or capture first; 3 = blocked on a decision or outside the books.

## Cash, bank & liquidity

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 1.1 | What is our current cash and bank balance across all accounts as of today? | local | `get_cash_bank_total` | answered | 1 | Ledgers in cash and bank groups; openings; voucher entries. | Signed sum of all cash and bank ledgers as of the latest posting. |
| 1.2 | Are there any cheques issued or received that are still uncleared or bouncing? | declined | `cheque_status` | not_in_books | 2 | Missing: cheque number, cheque date and clearing date on receipt and payment vouchers. | Not stored as fields today. |
| 1.3 | What is the difference between our bank statement balance and book balance for HDFC this month? | declined | `reconcile_bank` | planned | 2 | Bank statement lines. A statement parser exists (src/lib/statement-parse.ts); whether its lines are stored is not confirmed. | Needs the statement lines kept per account before a reconciliation can be answered. |
| 1.4 | Which bank or cash ledger has seen unusual spikes or out-of-pattern withdrawals recently? | local | `get_bank_anomalies` | answered | 1 | Voucher entries per bank and cash ledger, by month. | Flags a latest month whose outflow is at least 2× the earlier monthly average and at least ₹10,000. |
| 1.5 | How many days of operating runway do we have based on current cash and average monthly burn? | local | `get_cash_runway` | answered | 1 | Cash and bank total by date (answered); voucher dates. | Burn = fall in cash and bank over the three full months before the latest posting, ÷ 3. Runway = current position ÷ (burn ÷ 30). Says so when cash is not falling, is exhausted, or history is short. |

## Receivables & customers

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 2.1 | What is our total accounts receivable, broken down by aging buckets (0–30, 31–60, 61–90, 90+ days)? | local | `get_party_summary` | answered | 1 | Debtor ledgers; sales, receipt, credit note and journal entries; openings; recorded bill allocations. | Per party, largest first, with ageing buckets. Recorded bill allocations are applied first; FIFO covers only unallocated receipts. Advances, credit notes and other unmatched amounts are shown apart. Ageing is by bill date. |
| 2.2 | Which customers have overdue invoices past their credit limit or credit period? | local | `get_credit_watch` | answered | 1 | Receivable settlement per party (recorded allocations first, FIFO for the rest); credit limit and credit days per ledger. | Flags a customer over its credit limit (where set), or with a bill past its credit days. Credit days are the ledger's own where set; otherwise 30 days, disclosed per row. Opening balances count as overdue. |
| 2.3 | What is the total outstanding balance and payment history for Ram Traders? | local | `get_party_balance` | answered | 1 | Party ledger entries. | Balance from the party ledger; history from the ledger statement. |
| 2.4 | Which invoices are partially paid, unallocated, or sitting as customer advances? | declined | `bill_allocations` | planned | 1 | Bill-wise allocations are recorded when a receipt or payment is entered against bills (cache_bill_allocations). Partly paid and unallocated amounts can be derived from them. | Not built yet. The ageing answers still use FIFO for everything; switching them to recorded allocations is the next step under the calculation standards. |
| 2.5 | Who are our top 10 customers by revenue and by overdue balance this financial year? | local | `get_customer_ranking` | answered | 1 | Sales vouchers per customer (revenue); receivable ageing per customer (overdue). | Top 10 by sales revenue in the period, and top 10 by balance over 30 days old as on the period end. |

## Payables & vendors

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 3.1 | What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days? | declined | `payables_due` | planned | 2 | Payables total (available via the payables side of the party summary). Due dates on purchase bills: not confirmed in the schema. | The total can be answered now; the 7- and 15-day window needs a due date on each bill. |
| 3.2 | Which vendors have overdue balances or unadjusted debit notes/advances? | local | `get_vendor_overdue` | answered | 1 | Payable settlement per vendor (recorded allocations first, FIFO for the rest); credit days per ledger. | Flags a vendor with a payable past its credit days (30 where none is set, disclosed per row), or with an unadjusted advance or debit note. Advances and debit notes are listed separately. |
| 3.3 | What is the total spend and average payment cycle for ABC Traders over the last 6 months? | local | `get_vendor_spend_cycle` | answered | 1 | Purchase bills and payments on the vendor ledger, by date; recorded bill allocations (cache_bill_allocations). | Gross purchases less purchase returns (debit notes) less other debit adjustments gives net purchases, each shown separately. Payment cycle uses recorded bill allocations first; the unallocated part is matched FIFO and disclosed as an estimate. Payments that settled an opening balance are reported, not timed. |
| 3.4 | Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor? | local | `get_duplicate_check` | answered | 1 | Bill number (reference) on purchase vouchers, vendor, amount, payment dates and item rates. | Duplicate bill = same vendor and bill number. Repeat payment = same amount to the same vendor within 30 days. Price jump = more than 25% above the vendor's previous rate for the item. Thresholds are defaults and are stated in each answer. |
| 3.5 | Which vendors account for 80% of our purchase spend this year? | local | `get_vendor_concentration` | answered | 1 | Gross purchase bills per vendor in the period. | Vendors ranked by gross purchase spend, listed until the cumulative share reaches 80% (that vendor included). Returns are not deducted. |

## Sales, purchases & profitability

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 4.1 | What is our gross profit, operating profit, and net profit for March compared to the previous period? | cannot | `get_profit_loss` | planned | 3 | Profit and loss tool exists; closing stock from the year-end closure. | Blocked on the closing-stock decision for net profit. The wording is not routed to the tool yet. |
| 4.2 | Which products, services, or cost centres generate the highest margins and which ones are loss-making? | declined | `item_margins` | planned | 2 | Item-level sales and purchase lines with cost. Cost centres are stored; their link to items is not confirmed. | Margin per item needs item lines on sales and purchase vouchers. |
| 4.3 | What is our month-on-month revenue and expense trend for the current financial year? | local | `get_monthly_trend` | answered | 1 | Sales and expense ledger postings by voucher date. | Revenue = net credit to sales ledgers; expenses = net debit to direct and indirect expense ledgers; by month of voucher date, with month-on-month change. Net is before closing stock. |
| 4.4 | Which expense ledgers have exceeded budget or grown significantly compared to last month? | declined | `budget_variance` | not_in_books | 2 | Missing: budgets per expense ledger. Monthly growth can be computed without them. | Budget comparison needs a budget table first. |
| 4.5 | What is our total purchase return or sales return value this quarter, and why did it occur? | local | `get_returns_summary` | answered | 1 | Credit note and debit note vouchers: totals, dates, parties and narration. | Sales returns = credit notes; purchase returns = debit notes. Default period is the current financial-year quarter. The reason is the voucher narration; blank narration is reported as no reason recorded. |

## Inventory & stock

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 5.1 | What is the current stock quantity and valuation for Rice Basmati across all godowns? | local | `get_item_stock` | partial | 1 | Stock items (opening quantity and rate); stock lines on vouchers (quantity, rate, date). | Quantity and value for one item across all godowns. Value uses the last purchase rate. Godown split needs a godown on stock lines (not recorded), so it is not shown. |
| 5.2 | Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)? | local | `get_stock_movement` | answered | 1 | Stock movement dates and quantities per item (stock lines on vouchers); opening stock per item. | Items on hand only. Fast = 3+ movements in 30 days; dead = no movement for 90+ days or never moved; slow = last movement 31 to 90 days ago. Thresholds are defaults and are stated in each answer. |
| 5.3 | Which items are below reorder level and need a purchase order raised? | local | `get_stock_reorder` | answered | 1 | Reorder level (optional item field); current stock per item. | Items with a reorder level above zero and stock on hand at or below it. Items without a reorder level are not reported. |
| 5.4 | Are there negative stock balances or valuation mismatches between stock ledgers and financial accounts? | declined | `stock_audit` | planned | 1 | Stock valuation from items; stock ledger balances. | Mismatch tolerance needs agreeing. |
| 5.5 | What is the impact of stock valuation changes on Cost of Goods Sold (COGS) for this period? | cannot | `cogs` | planned | 3 | Opening and closing stock; purchases; sales cost. | Blocked on the closing-stock decision. |

## Tax, statutory & compliance

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 6.1 | What is our estimated net GST payable or available Input Tax Credit (ITC) for the current return period? | cannot | `gst_summary` | planned | 1 | Tax amounts on sales and purchase vouchers. GSTR-1, GSTR-2B, GSTR-3B and GSTR-9 report screens exist. | The chat's GST route (gst_query) feeds the model path, which the chat does not call, so no local answer yet. |
| 6.2 | Are there mismatches between purchase registers/books and inward tax statements (such as GSTR-2B) or sales records? | declined | `gstr2b_recon` | planned | 1 | GSTR-2B reconciliation code exists (src/lib/gstr2b-recon.ts); the purchase register. | The reconciliation runs in the app screens, not in chat. |
| 6.3 | Which transactions lack valid tax registration numbers, HSN/SAC codes, or proper tax invoices? | declined | `tax_compliance_check` | planned | 1 | GSTIN on parties; HSN on items and voucher lines. | Validity means present and well-formed, not verified with the tax authority. |
| 6.4 | How much TDS has been deducted across sections this quarter, and is any challan payment or return filing pending? | cannot | `tds_summary` | not_in_books | 2 | Missing: TDS section, amount and challan on vouchers. Only TDS ledgers, if kept, can be read today. | Needs TDS fields on vouchers before this can be answered. |
| 6.5 | Are there any unadjusted advance receipts or round-off/tax ledger discrepancies before period close? | declined | `round_off_check` | planned | 1 | Round-off and tax ledger balances; advance receipts from ageing. | Discrepancy threshold needs agreeing. |

## Ledger hygiene & audit readiness

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 7.1 | Which journal entries or vouchers were manually posted, backdated, edited, or deleted after period close? | declined | `voucher_audit` | planned | 2 | Activity log records AI-originated actions and year-end runs (src/lib/ai/audit-log.ts). Manual edits and backdating history are not stored. | Needs a change history on vouchers before edits can be reported. |
| 7.2 | Are there any suspense, uncategorised, or miscoded entries sitting in asset, liability, or expense ledgers? | declined | `suspense_check` | planned | 1 | Ledger names and groups; postings to suspense-type ledgers. | Miscoding beyond suspense ledgers needs an account-type rule per ledger. |
| 7.3 | Which vouchers are missing narration, supporting references, or proper cost-centre tags? | declined | `voucher_hygiene` | planned | 1 | Narration, reference number and cost-centre fields on vouchers. | Which vouchers need a reference is a rule to agree. |
| 7.4 | Do Trial Balance, Balance Sheet, and Profit & Loss totals reconcile cleanly with zero unexplained differences? | declined | `get_trial_balance` | planned | 1 | Trial balance engine; balance sheet and profit and loss totals. | The trial balance tool exists; this wording is not routed to it yet. Balance sheet and profit and loss checks are planned. |
| 7.5 | Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)? | local | `get_abnormal_balances` | answered | 1 | Ledger group and closing balance per ledger. | Ledger closing side opposite to its normal side. Duties and taxes are not checked; a bank in overdraft shows as abnormal. |
