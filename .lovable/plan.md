# Core Accounting Deficiencies — Audit Findings & Remediation Plan

Read-only audit of core bookkeeping functions (not market extras). Each gap below was verified against the codebase.

## Verified missing core functions

### 1. Contra voucher (cash ↔ bank transfers) — CRITICAL
No contra voucher type exists. `src/lib/voucher-postings.ts` and `src/lib/voucher-resolver.ts` do not handle `contra`; there is no `app.vouchers.new.contra.tsx` route. Only label/i18n strings mention it.
- Impact: everyday entries like "cash deposited into bank" or "bank withdrawal" cannot be recorded correctly — users must misuse payment/receipt vouchers, which corrupts cash-book and bank-book reporting.

### 2. TDS / TCS — HIGH
No TDS/TCS anywhere in voucher posting or GST logic. No TDS ledger groups, no deduction on payment vouchers, no TDS payable tracking or returns.
- Impact: any business deducting tax at source cannot keep compliant books.

### 3. Payroll — HIGH
No payroll/salary voucher generation, employee masters, or attendance. Salary can only be posted as a generic journal.
- Impact: a basic expectation for a business accounting product.

### 4. Physical stock reconciliation — MEDIUM
No physical-stock/stock-take voucher. Stock Summary is book-quantity only; shortages, breakage, and count corrections cannot be recorded.

### 5. Memorandum / reversing journals — MEDIUM
No memorandum vouchers (non-posting) and no auto-reversing journals for provisional/year-end adjustments. Accountants rely on these for accruals.

### 6. Multi-currency — LOW (defer)
No foreign-currency vouchers or forex gain/loss. Acceptable to defer for a domestic-focused product.

### 7. Budgets vs actuals — LOW (defer)
No budget definition or variance reporting.

## Robustness gaps (verified earlier, still open)

- 25k-record benchmark passes in isolation (~274ms avg) but flakes under full-suite load — needs a load-tolerant threshold or isolated perf job.
- Critical dependency vulnerabilities remain unaddressed (out of scope of recent security work).
- 57 Supabase linter warnings remain — all reviewed and by-design (pre-login/signup/trigger functions + intended `authenticated` execute).

## AI — status
The assistant layer is extensive (query router, planner, anomaly detection, OCR invoice capture, voice I/O, vector index, conversation memory). No verified core deficiency; a deeper read-only audit of end-to-end AI voucher creation accuracy would be the next audit candidate.

## Proposed remediation (priority order)

**Phase 1 — Contra voucher (do first, smallest and most critical)**
1. Add `contra` to voucher type registry, `voucher-postings.ts` (Dr bank/cash, Cr cash/bank only — restrict ledger selection to cash/bank groups), and `voucher-resolver.ts`.
2. New route `app.vouchers.new.contra.tsx` reusing the payment/receipt form pattern.
3. Day Book, Cash/Bank book, and voucher numbering integration.
4. Regression tests: posting balance, cash-book effect, edit/delete, backup round-trip.

**Phase 2 — Physical stock voucher**
Stock-take entry screen posting quantity-only adjustments through the existing stock journal pattern, feeding the WAC engine.

**Phase 3 — Memorandum & reversing journals**
Non-posting flag on journal vouchers (excluded from trial balance/reports) + auto-reverse-on-date journals.

**Phase 4 — TDS (basic)**
TDS section master + rate, deduction line on payment vouchers, TDS payable ledger auto-posting, simple TDS payable report. Returns filing deferred.

**Phase 5 — Payroll (basic)**
Employee master + monthly salary journal generator posting to payroll ledgers. No attendance/statutory filing initially.

Each phase is independently shippable, uses the existing voucher/posting/test architecture, and does not change the data model's local-only guarantees.

## Technical notes
- All new voucher types must flow through `readAccountingDataset`, voucher numbering, fingerprinting (`voucherFingerprint`), backup payload, and tombstone handling — the integration checklist used for manual valuations applies.
- No change to public API, accounting conventions already in place, or the WAC engine.
