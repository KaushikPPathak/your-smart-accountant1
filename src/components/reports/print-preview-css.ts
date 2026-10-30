// Stylesheet for the report print preview document. Shared by the preview and
// the print harness, so the printed layout is tested exactly as it is shipped.
export function printPreviewCss(orient: "portrait" | "landscape"): string {
  return `
    /* A4 margins: top 1in (header band), right 0.5in, bottom 0.5in (footer band), left 1in. */
    @page { size: A4 ${orient}; margin: 1in 0.5in 0.5in 1in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000;
      font: 9pt/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body { padding: 10mm; }
    .preview-bar { position: fixed; top: 0; left: 0; right: 0; display: flex;
      gap: 8px; padding: 8px 12px; background: #f5f5f5;
      border-bottom: 1px solid #ddd; font: 13px system-ui; z-index: 10; }
    .preview-bar button { padding: 6px 12px; border: 1px solid #888;
      background: #fff; border-radius: 4px; cursor: pointer; font: inherit; }
    .preview-content { margin-top: 48px; position: relative; z-index: 1; }
    .preview-content {
      color: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: #fff !important;
    }
    .preview-content * {
      color: inherit !important;
      background: #fff !important;
      box-shadow: none !important;
      visibility: inherit !important;
      opacity: inherit !important;
    }
    .preview-content table,
    .preview-content tbody,
    .preview-content thead,
    .preview-content tfoot,
    .preview-content tr,
    .preview-content td,
    .preview-content th {
      display: revert !important;
      color: #000 !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .preview-content table {
      border-collapse: collapse !important;
      width: 100% !important;
    }
    .preview-content [style*="transform"] { transform: none !important; }
    .preview-content,
    .preview-content > div,
    .preview-content > div > div,
    .preview-content > div > div > div {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      width: auto !important;
      min-width: 0 !important;
    }
    .preview-content thead th,
    .preview-content .row-bold,
    .preview-content tfoot {
      background-color: #f0f0f0 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-print-header { text-align: center; margin-bottom: 8pt; }
    .report-print-header > div { margin: 1pt 0; }
    .report-print-company-name {
      font-size: 12pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5pt; color: #002060 !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .report-print-title { font-size: 10pt; font-weight: 600; margin-top: 2pt; }
    .report-print-fy-line { font-size: 9pt; font-weight: 500; margin-top: 1pt; }
    .report-header-rule { height: 2px; border-top: 1px solid #000;
      border-bottom: 1px solid #000; margin: 3pt 0 6pt; }
    .preview-content, .preview-content * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th, td { border: 0.5pt solid #000; padding: 3pt 4pt; vertical-align: top;
      text-align: left; overflow-wrap: break-word; word-break: normal; }
    th { background: #f0f0f0; font-weight: 600;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td.num, th.num, .num { text-align: right; font-variant-numeric: tabular-nums;
      white-space: nowrap; }
    .row-bold td, .row-bold th, tfoot td, tfoot th { font-weight: 700;
      background: #f7f7f7; }
    .narration-cell { white-space: normal; word-break: break-word; }
    [class*="print:hidden"] { display: none !important; }
    .overflow-hidden { overflow: visible !important; }
    .run-head, .run-foot { display: none; }
    @media print {
      .preview-bar { display: none !important; }
      body { padding: 0; }
      .preview-content { margin-top: 0; padding-top: 0.35in; }
      /* Chromium/WebView2 ignore @page margin boxes, but repeat
         position:fixed elements on every printed page. */
      .run-head, .run-foot {
        display: flex; position: fixed; left: 0; right: 0;
        gap: 8pt; justify-content: space-between; align-items: baseline;
        font-size: 8pt; color: #000;
      }
      .run-head { top: 0; left: 0; right: 0; z-index: 5; background: #fff; font-weight: 700; border-bottom: 0.5pt solid #000; padding-bottom: 2pt; }
      .run-foot { bottom: 0; left: 0; right: 0; z-index: 5; background: #fff; color: #444; border-top: 0.5pt solid #999; padding-top: 2pt; }
      .preview-content { padding: 0; }
    .preview-content.report-print-root { padding: 0.35in 0 0 !important; }
    }

    /* ----------------------------------------------------------------
       Deterministic accounting print layout. The app's own stylesheet is
       loaded above this block, so utility classes still position things;
       these rules only pin down what MUST NOT change when printing.
       ---------------------------------------------------------------- */
    /* Screen-only widgets (virtualised grids) vs. their print tables. */
    [data-print-hide] { display: none !important; }
    [data-print-only] { display: block !important; }
    table[data-print-only] { display: table !important; }
    /* Two-column (Dr / Cr) accounting blocks never collapse to one column. */
    .preview-content [class*="grid-cols-2"] {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
    }
    .preview-content .flex { display: flex !important; }
    /* Truncation is a screen affordance; print must show the full value. */
    .preview-content .truncate {
      overflow: visible !important;
      text-overflow: clip !important;
      white-space: normal !important;
    }
    /* Sticky/zebra screen polish must not leak into paper. */
    .preview-content thead th { position: static !important; backdrop-filter: none !important; }
    .preview-content table { border-collapse: collapse !important; }
    /* Repeat headers, keep rows whole, keep totals with the table. */
    .preview-content thead { display: table-header-group !important; }
    .preview-content tfoot { display: table-footer-group !important; }
    .preview-content tr, .preview-content td, .preview-content th {
      page-break-inside: avoid; break-inside: avoid;
    }
    .preview-content table.report-data-table { table-layout: fixed !important; width: 100% !important; font-size: 8pt !important; }
    .preview-content .report-data-table td,
    .preview-content .report-data-table th {
      border: 0.5pt solid #000; padding: 2pt 3pt; line-height: 1.25;
      font-size: 8pt !important; font-family: inherit !important;
      overflow-wrap: break-word !important; word-break: normal !important;
      white-space: normal !important; vertical-align: top;
    }
    .preview-content .report-data-table .num { white-space: nowrap !important; overflow: hidden; }
    .preview-content .report-data-table th { text-transform: none !important; }
    /* Accounting totals: a single rule above the total row, a double rule
       below the closing row; closing and total rows read as bold. */
    .preview-content tfoot tr:first-child td,
    .preview-content tfoot tr:first-child th { border-top: 1pt solid #000 !important; }
    .preview-content tfoot tr:last-child td,
    .preview-content tfoot tr:last-child th { border-bottom: 2.5pt double #000 !important; font-weight: 700 !important; }
    @media print {
      [data-print-hide] { display: none !important; }
      [data-print-only] { display: block !important; }
      table[data-print-only] { display: table !important; }
    }
  `;
}
