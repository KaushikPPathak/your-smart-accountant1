# Accounting questionnaire: architecture

Generated from `src/lib/ai/question-catalog.ts`. Edit the catalogue, then regenerate this file.

Status: 9 answered, 0 partial, 23 planned, 3 not in the books.
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
| 2.1 | What is our total accounts receivable, broken down by aging buckets (0–30, 31–60, 61–90, 90+ days)? | local | `get_party_summary` | answered | 1 | Debtor ledgers; sales and receipt entries; openings. | Per party, largest first, with ageing buckets. Oldest bill settled first. |
| 2.2 | Which customers have overdue invoices past their credit limit or credit period? | local | `get_credit_watch` | answered | 1 | Receivable ageing per party; credit limit per ledger (optional). Credit days on the ledger are not used yet. | Flags a customer whose balance is above its credit limit (where set), or who has any balance over 30 days old. Opening balances count as overdue. |
| 2.3 | What is the total outstanding balance and payment history for Ram Traders? | local | `get_party_balance` | answered | 1 | Party ledger entries. | Balance from the party ledger; history from the ledger statement. |
| 2.4 | Which invoices are partially paid, unallocated, or sitting as customer advances? | declined | `bill_allocations` | planned | 1 | Bill-wise allocations are recorded when a receipt or payment is entered against bills (cache_bill_allocations). Partly paid and unallocated amounts can be derived from them. | Not built yet. The ageing answers still use FIFO for everything; switching them to recorded allocations is the next step under the calculation standards. |
| 2.5 | Who are our top 10 customers by revenue and by overdue balance this financial year? | local | `get_customer_ranking` | answered | 1 | Sales vouchers per customer (revenue); receivable ageing per customer (overdue). | Top 10 by sales revenue in the period, and top 10 by balance over 30 days old as on the period end. |

## Payables & vendors

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 3.1 | What is our total accounts payable, and which vendor bills are due in the next 7 or 15 days? | declined | `payables_due` | planned | 2 | Payables total (available via the payables side of the party summary). Due dates on purchase bills: not confirmed in the schema. | The total can be answered now; the 7- and 15-day window needs a due date on each bill. |
| 3.2 | Which vendors have overdue balances or unadjusted debit notes/advances? | local | `get_vendor_overdue` | answered | 1 | Payable ageing per vendor; unmatched excess (advances and debit notes) from the ageing. | Flags a vendor with a payable over 30 days old, or with an unadjusted advance or debit note. |
| 3.3 | What is the total spend and average payment cycle for ABC Traders over the last 6 months? | local | `get_vendor_spend_cycle` | answered | 1 | Purchase bills and payments on the vendor ledger, by date; recorded bill allocations (cache_bill_allocations). | Spend = purchase bills in the window (returns not deducted). Payment cycle uses recorded bill allocations first; the unallocated part is matched FIFO and disclosed as an estimate. |
| 3.4 | Are there duplicate bill numbers, unusual price jumps, or identical amounts paid to the same vendor? | declined | `duplicate_check` | planned | 1 | Voucher number, party, amount and item rate on purchase vouchers. | Price-jump threshold needs a definition. |
| 3.5 | Which vendors account for 80% of our purchase spend this year? | declined | `vendor_concentration` | planned | 1 | Purchase totals per vendor. | Cumulative share ranking. |

## Sales, purchases & profitability

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 4.1 | What is our gross profit, operating profit, and net profit for March compared to the previous period? | cannot | `get_profit_loss` | planned | 3 | Profit and loss tool exists; closing stock from the year-end closure. | Blocked on the closing-stock decision for net profit. The wording is not routed to the tool yet. |
| 4.2 | Which products, services, or cost centres generate the highest margins and which ones are loss-making? | declined | `item_margins` | planned | 2 | Item-level sales and purchase lines with cost. Cost centres are stored; their link to items is not confirmed. | Margin per item needs item lines on sales and purchase vouchers. |
| 4.3 | What is our month-on-month revenue and expense trend for the current financial year? | cannot | `monthly_trend` | planned | 1 | Sales and expense postings by voucher date. | Monthly groups of the same postings the sales total uses. |
| 4.4 | Which expense ledgers have exceeded budget or grown significantly compared to last month? | declined | `budget_variance` | not_in_books | 2 | Missing: budgets per expense ledger. Monthly growth can be computed without them. | Budget comparison needs a budget table first. |
| 4.5 | What is our total purchase return or sales return value this quarter, and why did it occur? | cannot | `returns_summary` | planned | 1 | Return vouchers and their totals; narration for the reason. | The reason is only as good as the narration entered. |

## Inventory & stock

| # | Question | Router | Tool | Status | Phase | Data | Note |
|---|---|---|---|---|---|---|---|
| 5.1 | What is the current stock quantity and valuation for Rice Basmati across all godowns? | cannot | `get_stock_summary` | planned | 1 | Stock items, godowns, closing stock valuation. The stock summary tool exists. | Wording is not routed to the tool yet. |
| 5.2 | Which stock items are fast-moving, slow-moving, or dead stock (no movement for 90+ days)? | declined | `stock_movement` | planned | 1 | Stock movement dates per item. | Thresholds (fast, slow, dead) need agreeing. |
| 5.3 | Which items are below reorder level and need a purchase order raised? | declined | `stock_reorder` | planned | 1 | Reorder level (optional item field); current stock per item. | Items without a reorder level are not reported. |
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
| 7.5 | Which accounts show abnormal balances (such as a credit balance in a normally debit expense/asset account)? | declined | `abnormal_balances` | planned | 1 | Ledger group and closing balance per ledger. | Expected sign per group needs a table. |

