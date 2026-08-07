# Make Print Preview & WhatsApp failures diagnosable (then fix)

The diagnostics file you exported contains only app lifecycle events (window close, tab hidden) and two copies of one crash:

`TypeError: Cannot read properties of undefined (reading 'toLowerCase')` — in minified code, so the real source line is unknown.

Critically, there is **no entry at all** from Print Preview or WhatsApp share. Those two flows currently only write to the browser console (`REPORT_PREVIEW_*`, `WHATSAPP_CLIPBOARD_FAILED`), which is invisible in the packaged desktop app and is never saved to the diagnostics log. That is why we keep guessing instead of knowing.

So step one is instrumentation, not another blind fix.

## Step 1 — Record every stage of both flows to the diagnostics log

Replace the console-only logging with durable `recordFailure` entries (already the mechanism behind the file you exported), one per stage, success or failure:

Print preview (`src/components/reports/ReportViewer.tsx`)
- `preview:start` — report name, node found yes/no, cloned HTML length
- `preview:blob` — blob size, URL created
- `preview:window` — popup opened or blocked
- `preview:written` — child document ready, body length as seen inside the popup
- `preview:error` — any thrown error with full stack

WhatsApp share (`src/lib/whatsapp-shared.ts`, `whatsapp-ledger.ts`, `ledger-pdf.ts`)
- `wa:pdf` — generated file path and byte size
- `wa:path-check` — absolute path, existence check result
- `wa:bridge` — which runtime was detected (Tauri / Electron / browser) and whether the `copy_files_to_clipboard` command is registered
- `wa:clipboard` — native command return value or error text
- `wa:url` — the WhatsApp URL opened

Each entry carries the runtime (Tauri vs Electron vs web) so we can tell which build the failure came from.

## Step 2 — Surface the log without needing F12

- Settings → Diagnostics gets a "Last run" panel showing the most recent preview/WhatsApp stage sequence in plain language, plus the existing Export button.
- A `Ctrl+Shift+D` shortcut opens that panel from anywhere, so a failure can be inspected immediately after it happens.
- Preview/WhatsApp failure toasts get a "Show details" action that opens the panel at the failing stage.

## Step 3 — Make the unnamed crash readable

The `toLowerCase` crash is unattributable because the desktop bundle ships without source maps. Enable hidden source maps for the desktop build and resolve minified frames to file/line when writing crash entries, so the next occurrence names the actual function. Also add a defensive guard where the crash most likely originates (string comparison on an optional field) once the resolved stack identifies it.

## Step 4 — Fix, using the evidence

After you reproduce both failures once and export the log again, the stage sequence will pinpoint the break (popup blocked vs empty clone vs missing native command vs path outside allowed scope), and I fix that specific point rather than the whole chain.

## Technical notes

- No new dependencies; reuses `src/lib/crash-log.ts` ring buffer (last 100 entries, device-local, never sent anywhere).
- Stage logging is cheap and stays permanently enabled — it is the only visibility available in a packaged build.
- No change to backup, ledger, or voucher logic.
