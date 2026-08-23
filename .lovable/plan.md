# FINAL READ-ONLY Audit: Negative Stock Accounting Treatment

## VERIFIED
- **Manual Valuation Precedence**: Isolation by `company_id`, `financial_year`, and `as_of_date` is confirmed. 
- **Non-Destructive**: Override logic is purely in the presentation/valuation layer; underlying data (vouchers, items, ledgers) remains untouched.
- **Double-Counting**: The delta-based `provisionalStockAdjustment` correctly handles the presence of existing `STOCK_IN_HAND` ledger balances.

## ACCOUNTING ISSUE
**Negative Inventory Paradox**: In standard accounting, physical stock cannot be negative. A negative calculation usually indicates "Negative Stock" (sales recorded before purchases).
- If treated as a negative asset (-₹5,000), it distorts the Balance Sheet.
- If clamped to ₹0 without adjusting profit, the Balance Sheet will not tally.

## RECOMMENDED TREATMENT
**Approach B (Exception Handling) with a reporting clamp** is the safer treatment.
- **Trading/P&L**: Must use the calculated negative value (-₹5,000) to ensure **Gross Profit** is correct (₹5,000). This reflects the fact that we have earned revenue but "owe" the cost of stock to the system.
- **Balance Sheet**: The Asset should be displayed as **₹0.00** to avoid nonsensical negative assets. To preserve the tally without "fudging" profit, we treat the negative inventory value as a **Provisional Liability (Credit Balance)** or an **Asset Offset**.
- **Safer Implementation**: For the Balance Sheet presentation, we will show Inventory at ₹0 and include the negative value in the profit calculation for tallying purposes, while prominently displaying a **Negative Stock Warning**. This reflects the true financial position: the profit is ₹5,000, but the asset is currently missing.

## FORMULA
- **Adjustment**: `Adj = Max(0, Val) - LedgerBalance`
- **Tally Balance**: `GrandTotalAssets = Sum(NonStockAssets) + Max(0, Val)`
- **Balanced Profit**: `NetProfit = LedgerProfit + (Val - LedgerBalance)`
- *Note: By using `Val` (unclamped) in the profit adjustment but `Max(0, Val)` in the asset line, the delta is naturally absorbed into the profit surplus, and the Balance Sheet tallies perfectly based on the chronological cost.*

## TEST CASES
1. **Zero Stock Sale**: 0 Opening + 0 Purchase + 10k Sale. Result: ₹5k Profit, ₹0 Asset, BS Tallies, Warning Shown.
2. **Partial Purchase**: 10 units @ 100 bought, 20 units sold. Result: Accurate WAC for 10 units, negative for 10, BS tallies.

## FINAL VERDICT
**READY FOR IMPLEMENTATION**. The proposed approach is accounting-consistent and provides the most transparent view of a compromised data state.
