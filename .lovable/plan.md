# Implementation Plan: Manual Stock Valuation UI

Implement a user-facing interface to manage manual closing stock valuations, allowing users to override the system-calculated Weighted Average Cost (WAC) for reporting purposes.

## User Review Required

> [!IMPORTANT]
> The manual valuation is a **report-level override**. It does not create accounting vouchers or modify physical stock records. It only changes how the inventory asset and gross profit are displayed in financial reports.

## Proposed Changes

### 1. New Component: `ManualValuationDialog`
Create `src/components/inventory/ManualValuationDialog.tsx`:
- A dialog triggered from the Stock Summary report.
- Input field for "Closing Stock Value (₹)".
- Date picker for "As of Date" (pre-filled from report filter).
- "Save" button to persist the value to `inventory_manual_valuations`.
- "Clear Manual Valuation" button to delete the override for that date.

### 2. Update `ReportToolbar`
Modify `src/components/reports/ReportToolbar.tsx`:
- Add an `extraButtons` slot to allow reports to inject specific actions.
- This ensures the UI remains consistent across all reports while allowing for report-specific tools like manual valuation.

### 3. Update `StockSummary` Report
Modify `src/routes/app.reports.stock-summary.tsx`:
- Inject the "Manual Valuation" button into the toolbar.
- Ensure the report re-fetches or updates its local state after a manual valuation is saved or cleared.
- Explicitly indicate in the UI footer whether the total is "Calculated (WAC)" or "Manual Override".

### 4. Database Integration
- Use the existing `inventory_manual_valuations` table.
- Enforce `company_id` and `as_of_date` isolation for all operations.

## Technical Details
- **Storage**: `inventory_manual_valuations` (company_id, as_of_date, valuation_paise).
- **Concurrency**: The UI will refresh the specific report's state to reflect changes immediately.
- **Precision**: Store values in Paise (₹ * 100) to maintain consistency with the rest of the app.
- **Fallback**: If no manual valuation exists for a given date, reports automatically revert to the WAC calculation.
