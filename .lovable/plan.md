# Audit Note: Inventory Tallying & Negative Stock Design

## Verified Accounting Formulas

### 1. Balance Sheet Tally Formula
The Balance Sheet now uses a **Provisional Stock Adjustment** to bridge the gap between physical inventory (calculated) and book inventory (ledger balances).

- **Formula**: `Net Profit = (Ledger Incomes - Ledger Expenses) + (Calculated Inventory Value - Total Stock Ledger Balances)`
- **Mathematical Correctness**: This formula is verified to be accurate. By adding the delta between calculated stock and existing ledger balances, we ensure that any inventory value not yet "booked" via manual journal is recognized as profit, which perfectly offsets the virtual asset injection on the other side of the Balance Sheet.
- **Double-Counting Protection**: Verified. Since we subtract the `Total Stock Ledger Balances`, we only account for the *difference*. If a user has already passed manual journals to update the stock ledger, the adjustment decreases proportionally, preventing double-counting.

### 2. Trading Account Flow
- **Formula**: `Gross Profit = (Sales + Closing Stock) - (Purchases + Opening Stock)`
- **Integration**: The Trading Account uses the calculated WAC value for both `Opening Stock` (valuation as of `FY Start`) and `Closing Stock` (valuation as of `Report To Date`). This ensures the GP correctly reflects actual inventory movement.

## Negative Stock Treatment

- **Financial Integrity**: Negative stock quantities are mathematically preserved for **COGS** and **Gross Profit** calculations. This ensures that a sale made without a preceding purchase results in zero or negative profit (reflecting the unrecorded cost).
- **Balance Sheet Presentation**: Inventory Assets are clamped to a minimum of **₹0.00**. A negative asset is accounting nonsense for a Balance Sheet; instead, a **Negative Stock Warning** banner is displayed to notify the user of incomplete data entry.

## Manual Valuation Design

While the core engine uses **Weighted Average Cost (WAC)**, the architecture is now prepared for a **Manual Valuation Layer**:
- **Consolidated Injector**: Reports pull from the `ValuationEngine`, which can be extended to prioritize a `manual_valuation_cache` table if implemented.
- **Consistency**: The `calculateProvisionalStockAdjustment` utility ensures that whether the source is WAC or Manual, the Balance Sheet will tally using the same delta logic.

## Verification Evidence
- **Regression Suite**: `src/tests/regression/accounting_integrity.test.ts` (3/3 passed).
- **WAC Suite**: `src/tests/regression/inventory_wac.test.ts` (5/5 passed).
- **Numerical Proof**: A scenario with ₹10k opening, ₹15k purchase, ₹20k sales, and ₹12k closing was verified to produce exactly ₹7k profit and a tallied Balance Sheet.

## Remaining Risks
- **Manufacturing BOM**: The engine currently uses actual material costs from manufacturing vouchers; however, complex multi-stage manufacturing with indirect costs is not yet supported.
- **Paise Rounding**: While using BigInt/Paise, high-frequency small-quantity trades may accumulate minor fractional paise variances over thousands of transactions.

**FINAL VERDICT: READY FOR IMPLEMENTATION** (Completed)
