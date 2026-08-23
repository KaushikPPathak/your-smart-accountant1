# Implementation Plan: Manual Stock Valuation UI

Implement a user-facing interface to manage manual total closing stock valuations, allowing users to override the system-calculated Weighted Average Cost (WAC) for reporting purposes.

## User Review Required

> [!IMPORTANT]
> The manual valuation is a **report-level total override**. It does not create accounting vouchers or modify physical stock records or item rates. It only changes how the total inventory asset and gross profit are displayed in financial reports.

## Proposed Changes

### 1. New Component: `ManualValuationDialog`
Create `src/components/inventory/ManualValuationDialog.tsx`:
- A dialog triggered from the Stock Summary report.
- Display "Calculated WAC Value" for comparison.
- Input field for "Manual Closing Stock Value (₹)".
- Dynamic display of "Difference" between WAC and Manual value.
- Date picker for "As of Date" (pre-filled from report filter).
- "Save" button to persist the value to `inventory_manual_valuations`.
- "Clear Manual Valuation" button to delete the override for that date.
- Explicit text clarifying this is a reporting override and does not create vouchers or modify item data.

### 2. Update `StockSummary` Report
Modify `src/routes/app.reports.stock-summary.tsx`:
- Add the "Manual Valuation" button to the report header/toolbar.
- Ensure the report re-fetches or updates its local state after a manual valuation is saved or cleared.
- Explicitly indicate in the UI footer whether the total is "Calculated (WAC)" or "Manual Override".

### 3. Database Integration & Logic
- Use the existing `inventory_manual_valuations` table.
- Enforce `company_id` + `financial_year` + `as_of_date` isolation for all operations.
- Ensure all reports (Trading, P&L, Balance Sheet) continue using the existing `resolveInventoryValuation()` precedence: Manual valuation → WAC fallback.

### 4. Regression Testing
- Create/Update tests to verify:
    - Saving a new manual valuation override.
    - Updating an existing override.
    - Clearing an override and correctly falling back to WAC.
    - Company, Financial Year, and Date isolation.
    - Report consistency across Trading/P&L/Balance Sheet.

## Technical Details
- **Storage**: `inventory_manual_valuations` (company_id, financial_year, as_of_date, valuation_paise).
- **Precision**: Store values in Paise (₹ * 100).
- **Fallback**: If no manual valuation exists for a given date/FY, reports automatically revert to the WAC calculation.

