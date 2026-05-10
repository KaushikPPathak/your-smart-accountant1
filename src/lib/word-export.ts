// Export an HTML element as a Word-compatible .doc file.
// Word opens "Word 2003 XML / HTML" documents natively, so we wrap the
// element's outerHTML in the MS Office XML namespace shell. No extra deps.
import { saveExport } from "./desktop-save";

export interface WordExportOptions {
  /** The DOM element whose innerHTML will be used as the document body. */
  element: HTMLElement;
  /** Title shown in Word's title bar / used as the document name. */
  title: string;
  /** File name including .doc extension. */
  fileName: string;
  /** Optional pre-body header HTML (e.g. company name + report title). */
  headerHtml?: string;
  /** "portrait" (default) or "landscape" — sets @page size. */
  orientation?: "portrait" | "landscape";
  /** Folder under company export root. Defaults to "Reports". */
  subFolder?: string;
}

const PAGE_CSS = (orientation: "portrait" | "landscape") => `
@page WordSection1 {
  size: ${orientation === "landscape" ? "29.7cm 21cm" : "21cm 29.7cm"};
  mso-page-orientation: ${orientation};
  margin: 1.2cm 1cm 1.2cm 1cm;
  mso-header-margin: .5cm;
  mso-footer-margin: .5cm;
}
div.WordSection1 { page: WordSection1; }
body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #000; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 0.5pt solid #000; padding: 4pt 5pt; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; text-align: left; }
.num, td.num, th.num { text-align: right; mso-number-format: "\\#\\,\\#\\#0\\.00"; white-space: nowrap; }
.row-bold td, .row-bold th { font-weight: 700; background: #f7f7f7; }
.report-print-header { text-align: center; margin-bottom: 8pt; padding-bottom: 4pt; border-bottom: 1pt solid #000; }
button, input, select, textarea, .print\\:hidden { display: none !important; }
`;

export function exportElementAsWord(opts: WordExportOptions): void {
  const orientation = opts.orientation ?? "portrait";
  // Clone so we can strip interactive bits without mutating the live DOM.
  const clone = opts.element.cloneNode(true) as HTMLElement;
  // Remove any element flagged as no-print
  clone.querySelectorAll(".print\\:hidden, button, input, select").forEach((n) => n.remove());

  const inner = (opts.headerHtml ? opts.headerHtml : "") + clone.innerHTML;

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:w="urn:schemas-microsoft-com:office:word"
        xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>${PAGE_CSS(orientation)}</style>
</head>
<body>
<div class="WordSection1">
${inner}
</div>
</body>
</html>`;

  // Prefix with BOM so Word reliably detects UTF-8.
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  void blob.arrayBuffer().then((buf) =>
    saveExport({
      subFolder: opts.subFolder ?? "Reports",
      fileName: opts.fileName,
      contents: buf,
      mime: "application/msword",
    }),
  );
}

/** Same as exportElementAsWord but accepts ready-made HTML (for batch reports
 *  built off-screen, e.g. "All Ledgers"). */
export function exportHtmlAsWord(opts: {
  bodyHtml: string;
  title: string;
  fileName: string;
  headerHtml?: string;
  orientation?: "portrait" | "landscape";
  subFolder?: string;
}): void {
  const orientation = opts.orientation ?? "portrait";
  const inner = (opts.headerHtml ?? "") + opts.bodyHtml;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:w="urn:schemas-microsoft-com:office:word"
        xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>
<![endif]-->
<style>${PAGE_CSS(orientation)}
.page-break { page-break-before: always; mso-special-character: line-break; }
h2.ledger-heading { font-size: 12pt; margin: 4pt 0; text-align: center; }
.period-line { font-size: 9pt; text-align: center; margin-bottom: 6pt; }
</style>
</head>
<body>
<div class="WordSection1">
${inner}
</div>
</body>
</html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  void blob.arrayBuffer().then((buf) =>
    saveExport({
      subFolder: opts.subFolder ?? "Reports",
      fileName: opts.fileName,
      contents: buf,
      mime: "application/msword",
    }),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
