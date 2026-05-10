## Goal
When the app language is switched to ગુજરાતી, every printed/exported book of account and financial report should render its labels and headings in Gujarati. Ledger names, item names, party names, amounts and dates remain as entered (per your choice).

## Scope of reports
Day Book, Ledger, Group Ledger, Cash/Bank Book, Sales Register, Purchase Register, Trial Balance, Profit & Loss, Balance Sheet, Trading, Outstanding/Receivables/Payables, Ageing, Stock Summary, GST Books (GSTR1/2B/3B, GST Sales/Purchase Book).

## Approach

### 1. Embed a Unicode Gujarati font in jsPDF
jsPDF's built-in Helvetica cannot render Gujarati glyphs (would print as boxes). We will:
- Add `NotoSansGujarati-Regular.ttf` and `-Bold.ttf` as static assets.
- Create `src/lib/pdf-fonts.ts` that lazily fetches the TTFs, base64-encodes them, and registers them on the jsPDF instance via `doc.addFileToVFS` + `doc.addFont` under family `NotoGujarati`.
- Expose `await ensureGujaratiFont(doc)` and `applyReportFont(doc, lang)` helpers that switch the active font to NotoGujarati when `lang === "gu"` and back to helvetica otherwise.

### 2. Centralize report-print labels
- Extend `src/lib/i18n.tsx` with a `report.*` key namespace covering every printed label: report titles ("Day Book", "Ledger", "Trial Balance", "Profit & Loss", "Balance Sheet", "Sales Register", …), column headers ("Date", "Particulars", "Vch No.", "Vch Type", "Debit", "Credit", "Balance", "Qty", "Rate", "Amount", "GSTIN", "CGST", "SGST", "IGST", …), section/footer labels ("Opening Balance", "Closing Balance", "Total", "Grand Total", "By", "To", "As at", "For the period", "Page x of y").
- Provide full `en` and `gu` translations; other languages fall back to English (existing behavior).

### 3. Wire labels + font into the export pipeline
- Update `src/lib/exporters.ts` (PDF + Excel/CSV builders) to accept a `lang` param. Before drawing, call `await ensureGujaratiFont(doc)` and `applyReportFont(doc, lang)`; pass the localized header/footer strings through.
- Update `src/lib/report-pdf-header.ts` to localize "As on", company address labels, "Printed on", "Page".
- Each report route (`app.reports.*`) currently builds its rows + headers inline. Replace the hard-coded English strings used for the print/export with `t("report.<key>")` from `useI18n()`. The on-screen UI already uses i18n; this change just routes the same translated strings into the exporter.

### 4. On-screen "Print preview" panes
Some reports (TrialBalance, ProfitLoss, BalanceSheet, Ledger printable view) render an HTML print layout. Add `lang={lang}` and a CSS class `.print-gu { font-family: "Noto Sans Gujarati", "Shrutib", system-ui, sans-serif; }` in `src/styles.css`, applied when `lang === "gu"`, so browser-print also looks correct.

### 5. Trigger
Pure "follow app language": `useI18n().lang` is read inside each report's export/print handler — no extra UI control. Switching the language switcher in the top bar instantly changes future printouts.

## Technical details

Files to add
- `src/assets/fonts/NotoSansGujarati-Regular.ttf`, `…-Bold.ttf` (downloaded from Google Fonts, ~250 KB each, lazy-loaded so the main bundle is unaffected).
- `src/lib/pdf-fonts.ts` — font loader/cache + `applyReportFont`.

Files to edit
- `src/lib/i18n.tsx` — add `report.*` keys for `en` and `gu`.
- `src/lib/exporters.ts` — accept `{ lang }`, await font, apply font, use localized headers passed in.
- `src/lib/report-pdf-header.ts` — localized header/footer.
- `src/lib/invoice-pdf.ts` — same font hook so voucher prints render Gujarati labels too (labels only; numbers/names unchanged).
- All `src/routes/app.reports.*.tsx` files (Day Book, Ledger, Group Ledger, Cash/Bank, Sales/Purchase Register, Trial Balance, P&L, Balance Sheet, Trading, Outstanding, Receivables, Payables, Ageing, Stock Summary, GST books) — pass `lang` and localized headers into the exporter calls.
- `src/styles.css` — `.print-gu` font stack + `@font-face` for screen print.

Out of scope (per your answer)
- Translating ledger/item/party names, transliterating numerals, or amount-in-words in Gujarati.

## Validation
- Switch language to ગુજરાતી → open Day Book → Print PDF → headings ("તારીખ", "વિગત", "ઉધાર", "જમા", "બાકી") render correctly with no tofu boxes.
- Repeat for Trial Balance, P&L, Balance Sheet, Ledger, Sales Register.
- Switch back to English → prints revert to Helvetica/English headings.
- Verify CSV/Excel exports also carry Gujarati column headers (UTF-8).
