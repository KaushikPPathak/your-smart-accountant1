## Adopt user's invoice layout as the print standard

The user pasted a concrete invoice layout (ABC Enterprises sample). Treat this as the chosen direction — replaces Directions A/B/C. Build it as the new invoice PDF, then extend the same visual language to Ledger / Cash Book / Bank Book / GST Register.

### What the pasted layout dictates

- **Header block** (no coloured band): Company name centered bold at top, address / GSTIN / State+Code left-aligned, Invoice No + Date right-aligned on the same row band. Ink-light — hairline rules only.
- **Bill To box**: single bordered rectangle, party name in caps, address, GSTIN.
- **Items table** — 6 columns only: `Sr. No. | Description of Goods | HSN/SAC | Quantity | Rate (₹) | Amount (₹)`. Qty cell shows number + unit on second line ("1,200 / Nos."). Description wraps to 2 lines. **No per-line CGST/SGST/IGST columns** — tax is summarised below.
- **Filler space** below last item row up to a fixed table height, with a single right-column "Total  61,145.00" cell sitting at the bottom of the filler.
- **Tax Classification Table** (HSN-wise): `HSN/SAC | Taxable Value | CGST % + Amount | SGST % + Amount` (IGST column swaps in for interstate). Totals row at bottom.
- **Total Invoice Value box**: Taxable, +CGST, +SGST (or +IGST), Less Discount, Round Off, Total — right-aligned amounts, hairline separator above Total.
- **Amount in words**, **Terms**, **"This is a system-generated invoice."**, **Authorized Signatory** block bottom-right.
- Currency `₹` throughout — requires the DejaVu Sans font path already proven in the samples.

### Build steps

1. **Rewrite `src/lib/invoice-pdf.ts`** to this layout.
   - Drop the navy header band and the wide per-line GST columns.
   - New 6-column items table using jsPDF-autotable with hairline borders, 8.5pt body / 9pt headers, small-caps column headers.
   - Compute HSN-wise tax summary from `voucher_items` (group by `hsn_code`, sum `taxable_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`; pick CGST+SGST vs IGST off `is_interstate`).
   - Totals box on the right; amount-in-words on the left using existing `amountInWords`.
   - Keep existing wiring: offline cache-fallback bundle, `saveExport`, watermark stamp, currency symbol via `exportCurrencySymbol()` — only the drawing code changes.
   - Register DejaVu Sans (or existing Noto path) so `₹` renders; fall back to `Rs.` if font load fails.

2. **Preview the new invoice** by generating a sample PDF into `/mnt/documents/` and QA'ing every page as images before declaring done (per PDF skill rules).

3. **Companion generators in the same visual language** (separate follow-up files, not touched this turn beyond stubs):
   - `src/lib/ledger-pdf.ts` — Ledger statement (Date | Particulars | Vch Type | Vch No | Debit | Credit | Balance).
   - `src/lib/cash-book-pdf.ts`, `src/lib/bank-book-pdf.ts` — same column shape, filtered to cash / bank ledgers.
   - `src/lib/gst-register-pdf.ts` — GST Sales / Purchase register with HSN-wise summary block reused from the invoice.
   All share a small `src/lib/pdf-theme.ts` helper (margins, hairline colour, header renderer, footer renderer, font bootstrap) so the look stays identical.

4. **No Settings toggle for print style** — the pasted layout becomes the single standard. (Earlier "Classic / Minimal / Compact" toggle idea is dropped unless you want it back.)

5. **QA loop** for every generator: render sample → `pdftoppm` → view images → fix overlaps / clipping → re-render.

### Technical notes

- `voucher_items` already carries `hsn_code` via the joined `items` relation and per-line `cgst_paise` / `sgst_paise` / `igst_paise`, so HSN-wise aggregation is a `reduce` over the existing `items` array — no new query.
- Filler + bottom-anchored subtotal row is done by measuring `lastAutoTable.finalY`, then drawing a manual rectangle down to a fixed Y and placing the "Total" cell inside it.
- Keep `stampWatermarkIfUnlicensed` and `saveExport` calls unchanged.

### Out of scope this turn

- Screen-side `ReportViewer` HTML restyle (print CSS). Only the PDF path changes now; HTML preview stays as-is until you confirm the PDF is right.
- Word / .doc export path.
