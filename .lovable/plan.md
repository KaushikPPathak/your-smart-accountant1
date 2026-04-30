## Why

Today the Tally / Busy importer has three separate tabs (Ledgers, Items, Vouchers) and asks you to upload one file per tab. That works well for **CSV / Excel** exports from Busy, because Busy exports each report (Account Books → Ledgers, Inventory → Items, Day Book → Vouchers) into its own file.

But Tally has a **"Masters + Transactions" XML export** that contains all three in one file, and Busy has a **"Complete Backup"** that does the same. You want to upload that single file once.

## What changes

Add a new first tab called **"All-in-One File"** to the Tally / Busy import card, alongside the existing three tabs.

Behaviour:

1. User uploads **one** file (XML, CSV, Excel, or ZIP).
2. The parser walks the file and **classifies every record** as a Ledger / Stock Item / Voucher using:
   - For Tally XML: the existing `__tally_kind` tag (`LEDGER`, `STOCKITEM`, `VOUCHER`) — already extracted.
   - For CSV / Excel: detect by columns present (Opening Balance + Group → ledger; HSN + Unit → item; Voucher No + Date + Amount → voucher) and by sheet name when the workbook has multiple sheets named "Ledgers", "Items", "Day Book", etc.
   - For Busy ZIP: unzip in-browser (`jszip`) and route each inner file through the same logic.
3. Show a single combined preview with three collapsible sections:

   ```text
   ┌─ Ledgers (124 found, 124 selected) ─ [▼]
   ├─ Items   ( 87 found,  87 selected) ─ [▼]
   └─ Vouchers(412 found, 412 selected) ─ [▼]
   ```
   Each section is the same review table used today, with row-level checkboxes.
4. One **"Import everything"** button posts in the correct order:
   1. Ledgers first (so vouchers can resolve party names).
   2. Items next.
   3. Vouchers last (auto-creating any party / Sales / Cash ledger still missing).
5. Progress toast: `Importing… 124 ledgers, 87 items, 412 vouchers (3 of 623 done)`.

The existing three single-purpose tabs stay as-is for users who prefer to import one type at a time.

## Technical notes

- Reuse `parseAnyFile()` and `parseTallyXml()` — they already produce row-shaped records with a `__tally_kind` marker.
- Add a small classifier `classifyRow(row)` that returns `"ledger" | "item" | "voucher" | "unknown"` based on the tag or column fingerprint.
- Extract the three "post" routines (`postLedgers`, `postItems`, `postVouchers`) from the existing components into shared helper functions in `src/lib/tally-busy-import.ts` so the new combined tab and the existing tabs both call them.
- Add `jszip` (~25 KB) to handle Busy `.zip` backups; skip if file isn't a zip.
- No database changes required.

## Files

- new `src/lib/tally-busy-import.ts` — shared parsers + posters.
- edit `src/components/housekeeping/TallyBusyImport.tsx` — add **All-in-One** tab, refactor existing tabs to use the shared posters.
- `bun add jszip @types/jszip`.
