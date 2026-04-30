## Goal

Stop the white screen on big Tally / Busy files (your `Master.xml` is ~416k lines / UTF-16) and make the importer comfortably handle very large exports — tens of thousands of ledgers / items / vouchers — with clear feedback at every step.

## What the user will see

1. **Before parsing** — as soon as a file is picked, a small info card shows:
   - File name, size in MB, detected type (XML / ZIP / Excel / CSV)
   - Estimated load time band ("Small <5s", "Medium 5–30s", "Large 30s–2 min", "Very large 2+ min — please keep this tab open")
   - A confirm button for files >10 MB so users don't accidentally freeze the tab.

2. **During parsing** — a progress card replaces the spinner:
   - Stage label ("Decoding file…", "Parsing XML…", "Classifying records…", "Building preview…")
   - Progress bar (% where measurable, indeterminate otherwise)
   - Live counters: ledgers / items / vouchers found so far
   - Cancel button.

3. **After parsing** — summary card always shows totals first:
   - "Found 12,431 ledgers, 8,902 items, 47,118 vouchers"
   - Preview tables show only the first 200 rows of each kind with a "Showing 200 of N — use search to find more" note and a search box. Selection ("import all / none / only filtered") works on the full set, not just the visible slice.
   - For >5,000 rows the preview switches to a virtualized list so the DOM stays small.

4. **During posting** — progress bar with "Posted 3,400 / 12,431 ledgers" and ETA. Errors don't abort the whole batch; failed rows are collected and shown at the end with a "Download failed rows as CSV" button.

5. **Safety net** — if anything still crashes, a local error boundary shows a friendly card ("Import ran into a problem — file was too large or malformed") instead of a blank screen, with a "Reset" button.

## Technical plan

### A. Robust file decoding (`src/lib/tally-busy-import.ts`)
- New `decodeFileSmart(file)` that:
  - Reads first 4 bytes to detect BOM: UTF-16 LE (`FF FE`), UTF-16 BE (`FE FF`), UTF-8 BOM (`EF BB BF`).
  - Falls back to heuristic: if >30% of first 1 KB are NUL bytes → treat as UTF-16LE.
  - Uses `TextDecoder('utf-16le' | 'utf-16be' | 'utf-8')` on the full ArrayBuffer.
  - Strips stray NULs and the BOM from the resulting string.
- Replace direct `readText` calls in `parseAnyFile` and `parseTallyXml` with `decodeFileSmart`.

### B. Streaming-style XML parsing
- Keep `fast-xml-parser` (already a dep) but run it inside a Web Worker so the main thread stays responsive on 50–500 MB strings.
- New file `src/workers/tally-parser.worker.ts` exposing `parse({ buffer, filename })` → returns `{ rows, stats }` and posts periodic `{ stage, percent, counts }` progress messages.
- New `parseFileOrZipWithProgress(file, onProgress, signal)` wrapper around the worker; falls back to in-thread parsing if Workers are unavailable (Electron edge case).
- ZIP path: iterate entries one-by-one and emit progress per entry instead of awaiting all.

### C. Chunked classification & mapping
- After parsing, run `classifyRow` / `mapLedger` / `mapItem` / `mapVoucher` in batches of 2,000 using `requestIdleCallback` (or `setTimeout(0)` fallback) so the UI can paint progress between batches.

### D. Virtualized, paginated preview (`TallyBusyImport.tsx`)
- Add `react-window` (small dep, ~6 KB) for the preview tables. When `rows.length > 500`, render with `FixedSizeList`; otherwise keep the current `<Table>`.
- Add a search input above each preview that filters the underlying full array (not the slice).
- Selection state stored as a `Set<string>` of keys instead of cloning the whole array on each toggle — fixes O(N) re-renders on big lists.

### E. Pre-flight + progress UI
- New component `src/components/housekeeping/ImportProgressCard.tsx` showing file metadata, size band, estimated time, current stage, percent, counts, and Cancel.
- Size bands (rough rule of thumb):
  - <2 MB → "A few seconds"
  - 2–10 MB → "5–30 seconds"
  - 10–50 MB → "30 seconds to 2 minutes — keep this tab open"
  - >50 MB → "Several minutes — keep this tab open and your laptop plugged in"
- For files >10 MB show a confirm dialog before parsing starts.

### F. Chunked posting (`postLedgers` / `postItems` / `postVouchers`)
- Update each poster to:
  - Insert in chunks of 500 rows (Supabase REST limit-friendly).
  - Accept an `onProgress(done, total)` callback.
  - Catch per-chunk errors, accumulate failed rows, and return `{ created, updated, skipped, failed: FailedRow[] }`.
- UI shows the progress bar and offers a CSV download of failed rows.

### G. Error boundary
- New `src/components/housekeeping/ImportErrorBoundary.tsx` (class component) wrapping `TallyBusyImport`'s content. On error: friendly message, "Reset" button that clears state, and a "Copy diagnostics" button (file name, size, stage, error message) so the user can paste it back to support.

### H. Documentation hint update
- Update the helper text on the All-in-One tab to:
  - Recommend exporting **separate** XML files (Masters, Day Book) for very large companies.
  - Mention that .001 / TDBK files are Tally binary backups and must be restored in Tally first.

## Files to add
- `src/workers/tally-parser.worker.ts`
- `src/components/housekeeping/ImportProgressCard.tsx`
- `src/components/housekeeping/ImportErrorBoundary.tsx`

## Files to edit
- `src/lib/tally-busy-import.ts` — `decodeFileSmart`, worker wrapper, chunked posters.
- `src/components/housekeeping/TallyBusyImport.tsx` — pre-flight, progress, virtualized preview, search, error boundary, Set-based selection.

## New dependency
- `react-window` (and `@types/react-window`) for virtualization.

## Out of scope (can do later if you want)
- Resuming interrupted imports across page reloads.
- Server-side parsing via an edge function (would also fix the issue, but Tally exports are private and processing client-side keeps your data on your machine).
