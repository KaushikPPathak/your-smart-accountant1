# Fix WhatsApp PDF failure — the oklch colour crash

The new diagnostics file names the failure exactly. One entry, scope `whatsapp`, stage `pdf-write`, runtime `tauri`:

`Error: Attempting to parse an unsupported color function "oklch"` — thrown inside `html2pdf-BusGxtJT.js` (html2canvas, bundled with html2pdf.js).

So the instrumentation worked: the WhatsApp share never got past PDF generation, which is why there was nothing on the clipboard to paste.

## Root cause (confirmed)

- The app's design tokens in `src/styles.css` are all defined as `oklch(...)` (`--background`, `--foreground`, `--primary`, and the rest).
- `downloadLedgerPdf` in `src/lib/ledger-pdf.ts` builds the ledger HTML, appends it to `document.body` (off-screen at `left: -9999px`), and hands that live node to html2pdf.
- Because the node lives inside the app document, every computed colour it inherits resolves to `oklch(...)`. html2canvas's colour parser predates `oklch` and throws on the first one it meets — before a single page is rendered.
- The ledger markup's own colours are already plain hex; the crash comes purely from inherited app tokens.

## The fix

Render the ledger PDF in an isolated document so no app CSS reaches it:

1. In `src/lib/ledger-pdf.ts`, replace the off-screen `div` with an off-screen `iframe` that has no stylesheet link. Write the existing `buildLedgerHtml` output into the iframe document, then pass the iframe's `body` to html2pdf. The iframe inherits nothing from `:root`, so no `oklch` value is ever computed.
2. Add an explicit hard reset at the top of the ledger stylesheet (`color: #000; background: #fff;` on `html, body, *`) so every colour html2canvas sees is a plain hex value regardless of environment.
3. Keep the existing stage logging, and add an `oklch` guard: if PDF generation still throws, log the stage plus the first offending computed colour so the next report is equally precise.
4. Clean up the iframe in a `finally` block so a failure can't leave a stray node behind.

## Print preview

The exported log has no `preview:*` entries at all, so Print Preview was not exercised in this session and there is no evidence about its current state. Print preview already renders through a Blob URL in a separate window rather than html2canvas, so it is not affected by this crash. After this fix ships, run Print Preview once and export again — if it still fails, the stage sequence will name the point and I fix that then.

## Technical notes

- Files touched: `src/lib/ledger-pdf.ts` only. No changes to styles, tokens, backup, ledger maths, or the Rust clipboard command.
- No new dependencies; html2pdf.js stays as installed.
- No change to the diagnostics schema — existing exports remain readable.
