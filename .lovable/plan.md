# READ-ONLY Audit: Inventory Tallying, Negative Stock, and Manual Valuation Design

## 1. Balance Sheet Tally & Adjustment
- **Verification**: The formula `Profit = (Income - Expense) + (Calculated Inventory - Current Stock Ledger Balance)` is mathematically sound. 
- **Isolation**: Every query and calculation in `fetchLedgerBalances` and `calculateWac` is already scoped by `company_id` and `to` (date), ensuring strict isolation.
- **Double-Counting**: By subtracting the `Total Stock Ledger Balance` from the `Calculated Inventory`, we only inject the *delta*. If a user manually adjusts the ledger, the adjustment value shrinks, preventing double-counting.

## 2. Negative Stock Treatment
- **Trading/P&L**: Using the negative valuation is correct for Gross Profit (COGS calculation). 
- **Balance Sheet Clamp**: If the calculated stock is -₹5,000, we display **₹0.00** in Assets.
- **Tally Proof**: 
  - If we clamp the Asset to 0, the Balance Sheet will **NOT** tally unless the Profit also reflects this clamp.
  - **Correction**: The `profitPaise` formula must also use the clamped value (`Math.max(0, inventoryValuation)`) for the Balance Sheet to remain balanced.

## 3. Manual Valuation Design
- **Storage Fields**: `id`, `company_id`, `as_of_date`, `valuation_paise`, `created_at`, `updated_at`.
- **Precedence**: The system will check for a manual entry for the specific `company_id` and `to` date. If found, it overrides the WAC result.
- **Consistency**: The `ValuationEngine` will become the central hub so all reports (Stock Summary, Trading, BS) use the same resolved value.

## 4. Regression & Test Plan
- **Test Case 9**: Manual entry override verification.
- **Test Case 10**: Clamped negative stock tally verification (Asset = 0, Profit adjusted to match).
- **Test Case 11**: Multi-company isolation during valuation fetch.

---

### VERIFIED
- Formula for bridging physical and book stock.
- Data isolation by company/date.
- Consistency across Trading, P&L, and Balance Sheet.

### RISKS/AMBIGUITIES
- **Negative Stock Tally**: Clamping assets to zero requires an equivalent adjustment in the profit formula, or the Balance Sheet will show a difference.

### REQUIRED DESIGN CHANGES
- Update `profitPaise` in `BalanceSheet.tsx` to use `Math.max(0, inventoryValuation)` when calculating the provisional adjustment for the Balance Sheet view specifically.

### EXACT FILES THAT WOULD BE CHANGED
- `src/lib/inventory/valuation-engine.ts` (Add manual check logic)
- `src/routes/app.reports.balance-sheet.tsx` (Profit formula update)
- `src/routes/app.reports.trading.tsx` (Precedence logic)
- `src/routes/app.reports.stock-summary.tsx` (Precedence logic)

### FINAL VERDICT
**READY FOR IMPLEMENTATION** (pending approval of the negative stock tally clamp logic).
