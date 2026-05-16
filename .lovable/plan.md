# Currency & Date Audit — PDF / XLSX Templates

Goal: every report exported to PDF or Excel uses the **company's chosen currency symbol and date format** (already wired in Phase 1), and Excel cells become **real numbers and real dates** (not pre-formatted strings) so users can sum, filter, and pivot in Excel itself.

## What stays out of scope

- Static regulatory copy in the UI (e.g. "turnover > ₹5 Cr", "B2CL > ₹2.5L", "E-way bill > ₹50,000"). These are India-specific GST thresholds and should remain `₹` literals — they describe Indian law, not the user's money.
- "Amount in words" (lakh/crore vs million) — explicitly out per the scope you chose.
- Email/WhatsApp share templates — out per scope.

## Audit findings (what's broken today)

1. **Hard-coded "Rs."** in `src/lib/invoice-pdf.ts:326` (tax amount-in-figures box).
2. **Column header literals** like `"Amount (₹)"`, `"Purchase ₹"`, `"Sale ₹"` in ~10 report route files (trial-balance, balance-sheet, trading, group-ledger, stock-summary, items, etc.) — these pass straight into PDF heads and XLSX header rows.
3. **XLSX exports are all strings.** `src/lib/exporters.ts` `downloadXlsx` does `aoa_to_sheet(rows)` with pre-formatted currency strings (`"₹ 1,23,456.00"`) — Excel sees them as text, breaking SUM and pivot.
4. **XLSX date cells** are also strings (output of `fmtIndianDate`) instead of Excel date serials with a `numFmt`.
5. **No central Excel format helpers** — every route formats its own way.

## Implementation

### 1. New shared helpers — `src/lib/export-format.ts` (new file)

```ts
// Currency symbol for export headers/footers.
export function exportCurrencySymbol(): string;          // reads currency.tsx
// Tagged-template style: amountHeader("Amount") → "Amount (₹)" / "Amount ($)"
export function amountHeader(label = "Amount"): string;

// SheetJS numFmt strings derived from the company currency
//   "₹ #,##,##0.00;[Red]-₹ #,##,##0.00"   (Indian grouping for INR)
//   "$#,##0.00;[Red]-$#,##0.00"            (Western grouping otherwise)
export function excelCurrencyFmt(): string;
export function excelDateFmt(): string;                   // derives from date.format

// Builds an XLSX cell object {v,t,z} from a paise integer
export function moneyCell(paise: number): XLSX.CellObject;
// Builds an XLSX cell object {v,t,z} from an ISO date string / Date
export function dateCell(d: string | Date | null): XLSX.CellObject;
```

These wrap SheetJS so callers stay terse.

### 2. Upgrade `src/lib/exporters.ts` — XlsxSheet type

Extend the row type to accept cell objects, not just strings/numbers:

```ts
export type XlsxCell = string | number | XLSX.CellObject;
export interface XlsxSheet { name: string; rows: XlsxCell[][] }
```

`downloadXlsx` already passes rows to `aoa_to_sheet`, which natively accepts cell objects with `{ v, t, z }`. Localisation logic only touches strings, so cell objects flow through untouched. Add a post-pass that sets column widths based on header length so number columns aren't clipped.

### 3. Fix `invoice-pdf.ts`

- Replace `` `Rs. ${val}` `` with `` `${exportCurrencySymbol()} ${val}` ``.
- Sweep other "amount in figures" / total lines in the same file for any `₹` literals and route through the helper.

### 4. Refactor PDF callers (report routes)

For each of these files, replace inline `"Amount (₹)"` with `amountHeader("Amount")`:

- `app.reports.trial-balance.tsx`
- `app.reports.balance-sheet.tsx`
- `app.reports.trading.tsx`
- `app.reports.group-ledger.tsx`
- `app.reports.stock-summary.tsx`
- `app.reports.profit-loss.tsx`
- `app.reports.cash-bank.tsx`
- `app.reports.day-book.tsx`
- `app.reports.sales-register.tsx`
- `app.reports.receivables.tsx`
- `app.reports.ledger.tsx`
- `app.reports.brs.tsx`
- `app.items.tsx` (Items master export)

Same files: where they build XLSX `rows`, swap `formatINR(p)` cells → `moneyCell(p)` and `fmtIndianDate(d)` cells → `dateCell(d)`. PDF body keeps the formatted string (PDFs need pre-rendered text); only XLSX gains typed cells.

### 5. Localised UI labels (kept as-is, documented)

Leave these as `₹` literals because they describe Indian GST rules, not the user's currency:
- `app.companies.tsx` thresholds & turnover hints
- `app.settings.tsx` QRMP threshold text
- `app.einvoice.tsx` e-way bill copy
- `app.reports.gstr*.tsx` section titles citing statutory limits

Add a one-line code comment near each so future contributors don't "fix" them by accident.

### 6. Date sweep

`fmtIndianDate` already routes through the global format. Verify no remaining `toLocaleDateString` / `format(d, "dd/MM/yyyy")` calls inside exporter code paths; replace any survivors with `fmtIndianDate` for PDFs and `dateCell` for XLSX.

### 7. QA

After edits, manually export one of each:
- A simple report (Trial Balance) → confirm PDF header reads "Amount ($)" when company currency is USD; XLSX SUM works.
- An invoice PDF → confirm "Rs." is gone.
- A date-heavy report (Day Book) → switch global date format to `yyyy-mm-dd`, re-export, confirm both PDF text and Excel cell display update.

Run `tsc --noEmit` to confirm the broadened `XlsxCell` type doesn't break existing call sites.

## Files touched (estimate)

- New: `src/lib/export-format.ts` (~120 lines)
- Edited: `src/lib/exporters.ts`, `src/lib/invoice-pdf.ts`, plus 13 report route files (header literal + XLSX cell swaps, ~5 lines each)

## Out-of-scope reminder

Amount-in-words localisation, email templates, and the regulatory-threshold copy stay untouched in this pass.
