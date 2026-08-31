# Competitive Gap List — What the App Must Add

Based on a read of the current codebase (vouchers, reports, GST, inventory, backup, security), here is what is genuinely missing versus what mainstream Indian accounting products ship. Ordered by how much each one blocks a real buyer.

## Tier 1 — Deal-breakers (a firm cannot switch without these)

1. **TDS / TCS engine.** Today TDS exists only as a ledger group name and a tax-audit mention. Missing: section master (194C/194J/194H/194Q, 206C), automatic deduction on purchase/payment vouchers with threshold and rate logic, PAN-based higher-rate handling, TDS payable ledger auto-posting, challan (281) tracking, and Form 26Q/27Q/24Q export. Every business with vendors needs this monthly.
2. **Payroll.** Zero code exists. Missing: employee master, salary structure, attendance/LOP, PF/ESI/PT/TDS on salary, payslip PDF, salary journal posting, and PF/ESI return files. This is a standard module in every competing product.
3. **Live e-invoice + e-way bill.** The IRP integration is a stub that always returns "unavailable"; the DB tables and payload builder exist but nothing transmits. Mandatory for turnover above the notified threshold — without it, invoices are legally incomplete for many users.
4. **GSTR-9 / 9C annual return.** GSTR-1, 2B, 3B exist; the annual return and reconciliation statement do not.
5. **Role-based permissions inside the app.** There are admin/staff app users, but no per-module/per-voucher-type rights, no approval workflow, and no "restrict backdated entry" control. Buyers with more than two users ask for this first.

## Tier 2 — Expected as standard (absence looks like a toy)

6. **Multi-godown / location inventory.** Stock is single-pool. No godown master, no stock transfer voucher, no godown-wise stock summary.
7. **Batch, expiry and serial tracking.** Only a free-form `specs` JSON exists. Pharma, food, electronics cannot use the app at all without batch/expiry and FEFO issue.
8. **Price lists and discount slabs.** No party-wise or quantity-wise rate master; every invoice rate is typed manually.
9. **Cheque printing and post-dated cheque register.** Referenced in text but no print layout or PDC tracking.
10. **Budgets and variance reporting.** No budget master, no budget-vs-actual column in P&L or group summary.
11. **Cost centre depth.** Cost centres exist, but there is no cost-centre allocation on each voucher line and no cost-centre P&L.
12. **Multi-currency for regular ledgers.** FX exists only on export invoices; no forex ledger revaluation, no gain/loss posting.

## Tier 3 — Competitive polish (wins deals, not required to enter)

13. **Barcode / POS billing screen** with scanner input and quick tender.
14. **Interest calculation on overdue receivables** (the MSME interest helper exists but is not a full interest-on-outstanding engine).
15. **Bill-of-materials costing depth** — job work challans (Form ITC-04), subcontracting stock with vendors.
16. **Fixed asset register with book depreciation** (only income-tax block WDV exists today; no Companies Act SLM/WDV schedule).
17. **Document management** — attach scanned bills/receipts to vouchers.
18. **Scheduled/automated backup to the user's own cloud with a restore drill reminder** (manual and opt-in cloud exist; scheduling and verification do not).

## What is already competitive (no work needed)

Double-entry with balance invariants, full voucher set including manufacturing, GST returns (1/2B/3B) with reconciliation, bank import and reconciliation, ageing/outstanding, NCE-aware Balance Sheet, P&L, Trading, Receipts & Payments, WAC inventory valuation with manual override, period locks, audit/activity log, offline-first local data ownership, backup/restore with tombstone safety, and report printing.

## Suggested build order

Phase 1: TDS/TCS engine → role-based permissions → live e-invoice/e-way bill.
Phase 2: Multi-godown + batch/expiry → price lists → cheque printing.
Phase 3: Payroll → GSTR-9/9C → budgets → cost-centre allocation.

Each phase is independently shippable and none of them require changing the existing accounting core, local-only data model, or report engine.

## Next step

Tell me which single item to plan in detail and I will write an implementation plan for it (schema, postings, UI, reports, tests) before touching any code.
