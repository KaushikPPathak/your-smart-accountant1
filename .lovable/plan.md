# Implementation Plan - Inventory Tallying & Negative Stock Hardening

This plan addresses two critical issues identified in the Weighted Average Cost (WAC) engine audit: the failure of the Balance Sheet to tally when using calculated inventory, and the incorrect financial representation of negative stock.

## Proposed Changes

### 1. Balance Sheet Tally Logic
The Balance Sheet currently replaces static stock ledgers with a calculated valuation but does not update the Net Profit formula, leading to a mismatch.

- **Formula**: `Net Profit = (Ledger Income - Ledger Expenses) + (Calculated Closing Stock - Total Recorded Stock Ledger Balance)`.
- **Logic**: This "Provisional Stock Adjustment" ensures that the delta between the physical stock (WAC engine) and the book stock (ledger balances) is recognized as profit/loss for the period.
- **Affected File**: `src/routes/app.reports.balance-sheet.tsx`.

### 2. Negative Stock Treatment
Selling stock before recording a purchase results in negative quantities.

- **Financial Treatment**: In the **Balance Sheet**, inventory assets cannot be negative. If calculated stock is negative, it will be reported as **₹0.00** in the Asset column to prevent distorting the company's net worth.
- **Trading/P&L Treatment**: The negative value will be preserved for **Gross Profit** calculation to ensure the cost of "unrecorded purchases" is mathematically reflected, providing an accurate (albeit physically impossible) profitability view.
- **UI Warning**: A critical warning banner will be added to the Balance Sheet and Stock Summary when negative stock is detected, indicating that the reported values are provisional and data entry is incomplete.
- **Affected Files**: `src/routes/app.reports.balance-sheet.tsx`, `src/routes/app.reports.stock-summary.tsx`.

## Numerical Verification (Tallying)

**Data:**
- Opening Stock (in Ledger): ₹10,000
- Purchases recorded: ₹15,000
- Sales recorded: ₹20,000
- Closing Stock (Calculated by WAC): ₹12,000

**Calculation:**
1. **Assets Side**: Inventory (Calculated) = ₹12,000.
2. **Income/Expense Contribution**: ₹20,000 (Sales) - ₹15,000 (Purchase) = ₹5,000.
3. **Provisional Adjustment**: ₹12,000 (Calculated) - ₹10,000 (Opening Ledger) = ₹2,000.
4. **Final Net Profit**: ₹5,000 + ₹2,000 = **₹7,000**.
5. **Equation Check**: Assets (₹12,000 + others) = Liabilities + Capital + ₹7,000.
   - The ₹2,000 increase in Assets is perfectly offset by the ₹2,000 increase in Profit.
   - **Tally Verified.**

## Technical Details

- **Utility Enhancement**: Create `calculateProvisionalStockAdjustment` in `src/lib/inventory/valuation-engine.ts` to centralize this logic.
- **Precision**: Maintain all calculations in `paise` to avoid rounding errors.
- **Reporting**: Update `partitionedBalances` in `BalanceSheet.tsx` to explicitly handle the `stock_in_hand` ledger removal and virtual ledger injection in a single atomic memo.

## Verification Plan

### Automated Regression Tests
- **Test Case 6**: "Verified Balance Sheet tallies with dynamic inventory adjustment."
- **Test Case 7**: "Verified negative stock is reported as ₹0 asset in Balance Sheet."
- **Test Case 8**: "Verified Gross Profit correctly handles negative closing stock value for COGS."

### Manual Verification
1. Create a company with opening stock.
2. Record purchases at different rates.
3. Verify Trading GP matches Balance Sheet Profit.
4. Record a sale exceeding stock and verify the Balance Sheet reports ₹0 inventory with a warning banner.

**READY FOR IMPLEMENTATION**
