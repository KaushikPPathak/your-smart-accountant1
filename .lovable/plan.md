## Problem found

For **Mrs. Madhuben Hasmukhbhai Shah**, the data did restore: the database has **120 vouchers and 247 voucher entries**. The P&L is blank/wrong because the restored data contains a **year-end closing journal** dated **2026-03-31** with narration like **“Net Profit Transferred from Profit & Loss Account”**.

That journal correctly closes income/expense ledgers to Capital for Balance Sheet, but the current P&L report includes it, so income and expenses become zero for the full year. Balance Sheet still appears because it is meant to include the transfer.

## Plan

1. **Add a report-safe filter for closing transfer entries**
   - In shared report balance calculation, add an option to exclude P&L closing journals.
   - Detect these entries by journal type plus narration containing phrases like:
     - `Profit & Loss`
     - `Profit and Loss`
     - `Net Profit Transferred`
     - `Net Loss Transferred`
     - `Income & Expenditure`

2. **Apply the filter only to period P&L-style reports**
   - Profit & Loss report: exclude closing transfer entries.
   - Trading report: exclude closing transfer entries.
   - Tax audit P&L calculations: exclude closing transfer entries where appropriate.
   - Balance Sheet and Trial Balance: keep existing behavior, because Balance Sheet should include the capital transfer.

3. **Keep restore logic unchanged for now**
   - The restore itself is not the main failure for this company; entries are present.
   - We should not delete or mutate accounting data automatically because the year-end closing journal may be intentionally present.

4. **Add a visible accounting note in P&L**
   - Show a small inline note when closing transfer entries are excluded, so it is clear that the report is showing operational Profit & Loss before year-end appropriation.

5. **Verify with this company’s data**
   - Confirm P&L shows Salary Income, FD Interest, Dividend, Bank Charges, etc.
   - Confirm Balance Sheet remains unchanged/tallied.
   - Confirm this does not affect companies without year-end closing journals.

## Expected result

For **Mrs. Madhuben Hasmukhbhai Shah**, Profit & Loss will show the actual income/expense activity again instead of becoming blank/zero after restore, while Balance Sheet continues to show the closing transfer correctly.