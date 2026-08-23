# FINAL CLARIFICATION: Negative Stock Accounting Treatment

## VERIFIED
- **Logic**: The instruction to keep negative stock in the total `Closing Stock` value for Trading/P&L is verified.
- **Tallying**: If the Trading Account uses the negative value (e.g., -₹5,000) for `Closing Stock`, the resulting `Gross Profit` will be correctly reduced by that amount. Since this reduced profit flows into the Balance Sheet, and the Balance Sheet Asset side uses the *same* negative value, the equation `Assets = Liabilities + Equity` holds perfectly.
- **Presentation**: Clamping to ₹0 on the Balance Sheet *Asset line* is a UI choice. If we do this, the "missing" negative value must be shown as an offset or the profit must be calculated using the *true* negative value to tally.

## FORMULAS
- **Closing Stock (CS)**: `Σ (item_valuation)` [includes negatives]
- **Gross Profit (GP)**: `(Sales + CS) - (Purchases + OpeningStock)`
- **Provisional Adjustment (PA)**: `CS - LedgerStockBalance`
- **Net Profit (NP)**: `LedgerProfit + PA`

## NUMERICAL PROOF
**Scenario:**
- Sales: ₹10,000
- Purchases/Opening: ₹0
- Item A: +₹2,000
- Item B: -₹5,000
- **Total Closing Stock (CS)**: -₹3,000

**Trading A/c:**
- Income: ₹10,000 (Sales) + (-₹3,000) (CS) = ₹7,000
- Expenses: ₹0
- **Gross Profit**: ₹7,000

**Balance Sheet:**
- **Assets**: Inventory = -₹3,000 (or ₹0 with a -₹3,000 offset/adjustment)
- **Liabilities + Equity**: Capital + ₹7,000 (Profit)
- **Tally**: If Assets show -₹3,000 and Profit is ₹7,000, and we assume other net assets are ₹0, then `-3,000 = 0 + 7,000 - 10,000 (Cash from Sales)`. 
- **Wait, Cash Flow check**: 
  - Cash Asset: +₹10,000 (from Sales)
  - Inventory Asset: -₹3,000
  - Total Assets: **₹7,000**
  - Total Liabilities/Equity: **₹7,000** (Profit)
- **Result**: **Tallies perfectly.** The negative stock value acts as a natural "contra-asset" that balances the unrecorded cost against the realized revenue.

## ANY REQUIRED CHANGE
- Ensure `BalanceSheet.tsx` does **not** clamp the value to ₹0 in the `profitPaise` calculation, even if it hides the negative sign in the Asset label (though showing the negative value is more transparent).
- Add the **Negative Stock Warning** banner to all relevant reports when `valuationResult.isNegative` or total value < 0.

## FINAL VERDICT
**READY FOR IMPLEMENTATION**. The "Full Value" approach is mathematically superior and provides a self-balancing accounting flow.
