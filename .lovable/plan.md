# Plan: Enhance Sales Workflow with Party Locking and Partial Quantity Tracking

Enhance the `Estimate → Sales Order → Sales Invoice` workflow by enforcing strict party consistency throughout the chain and tracking item quantities for partial conversion/invoicing.

## User Review Required

> [!IMPORTANT]
> - The party will be locked once a source document (Estimate/Order) is selected.
> - The existing `original_voucher_id` field in the database will be used for linking.
> - Quantity tracking will be handled by comparing the source document's items with the current voucher's items using `item_id`.

- Does the user want a visual indicator of the "Locked" party state in the UI? (Assumed yes, via disabling the party picker once a source is selected).
- For partial invoicing, should the system automatically suggest the *remaining* quantity when carrying forward? (Assumed yes).

## Proposed Changes

### Logic & Data Layer
- **`src/lib/doc-linking.ts`**
  - Update `SOURCE_STAGES` to include `quotation` as a source for `sales_order` and `sales_order` for `sales`.
  - Enhance `listSourceDocs` to filter by party and potentially return progress status.
  - Implement `calculatePendingQuantities` to help the UI suggest correct amounts for partial conversions.

- **`src/lib/offline/voucher-executors.ts`**
  - Add business logic validation in `runLocalItemVoucherCreate` to ensure `partyId` matches the `party_ledger_id` of the `original_voucher_id`.
  - Throw a clear error if there is a mismatch, preventing the save.

### Components
- **`src/components/vouchers/ItemVoucherForm.tsx`**
  - Modify the "Carry forward from" logic to:
    1. Lock the party selection once a source document is chosen.
    2. Enforce party-first selection: the user must select a party to see their pending source documents.
    3. Update the UI to show an error if the user attempts to bypass party locking.
    4. Populate the item grid with *pending* quantities from the source document.
    5. Show status badges (Pending, Partially Converted, etc.) if applicable.

## Technical Details
- Use `offlineDb.cache_vouchers` and `cache_voucher_items` to calculate consumed quantities locally.
- Quantity tracking logic: `Pending = Source.Qty - SUM(LaterDocuments.Qty)`.
- The `original_voucher_id` on the `vouchers` table will be the primary link.
- For RLS/Cloud compatibility, the same logic will be mirrored in the Supabase path within `doc-linking.ts`.

## Verification Plan
- **Automated Tests**: Add a Playwright test to:
  1. Create an Estimate for Party A.
  2. Create a Sales Order, select Party B, and try to link the Estimate (should fail/not be allowed).
  3. Create a Sales Order for Party A, link the Estimate, and verify party locking.
  4. Perform partial invoicing and check if the remaining quantity is suggested next time.
- **Manual Verification**: Check the UI for "Locked" states and clear error messages on party mismatch.
