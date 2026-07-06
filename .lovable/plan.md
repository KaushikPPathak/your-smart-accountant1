# Zero-Loss Data Integrity & Silent Auto-Restore

Goal: no user should ever see an empty app after an update, reinstall, or WebView profile shift. The app must self-heal from local snapshots without asking. Prompts appear only for genuinely ambiguous cases (e.g. two different data sets found).

## Core Principles (enforced in memory as constraints)

1. Local business data is permanent — never auto-deleted.
2. Every write produces a durable trail: live IndexedDB + rolling snapshot on disk.
3. On launch, the app **verifies** integrity. If live DB is empty/damaged but snapshots exist → auto-restore silently. User sees a small toast: "Restored from local safety snapshot (dated …)".
4. No user prompt unless we truly cannot decide (multiple companies, conflicting timestamps newer than current DB).
5. Snapshots live outside anything an installer can touch (already pinned to `%LOCALAPPDATA%\com.smartaccountant.app\snapshots\`).

## What Gets Built

### 1. Integrity manifest (`src/lib/integrity.ts`)
- On every successful write batch, update a per-company manifest in IndexedDB `meta`:
  `{ companyId, lastWriteAt, ledgerCount, voucherCount, itemCount, rowsHash }`.
- Also mirrored into `<root>/state/integrity.json` on desktop (atomic write: temp file → rename).
- Cheap: aggregated on save queue flush, not per row.

### 2. Launch self-check (`src/lib/auto-restore.ts`)
Runs before UI renders company data. Order:
1. Read `state/integrity.json` (last known good).
2. Count live IndexedDB per company.
3. Classify each company:
   - **OK** — counts match manifest (±small delta) → do nothing.
   - **EMPTY-BUT-EXPECTED** — manifest says N>0, live=0 → auto-restore from newest valid snapshot silently.
   - **SHRUNK** — live count < 50% of manifest → auto-restore, keep current as `pre-autorestore` safety copy in `meta`.
   - **UNKNOWN** — no manifest (fresh install) → do nothing; if snapshots exist on disk for this identifier, offer one-tap "Import previous data" (only real prompt).
4. Result surfaced as a non-blocking toast + entry in a new **Data Health** page.

### 3. Snapshot selection & validation
- Reuse `backup-inspect.ts` to verify SHA-256 + schema before restore.
- Pick newest snapshot whose `ledgerCount + voucherCount >= manifest.count * 0.9` (skips the "2 KB empty" files from the July incident automatically).
- Fall back to next-newest if top candidate fails checksum.

### 4. Snapshot cadence hardening
- Current: once/day on launch. Add:
  - Snapshot on **graceful shutdown** (`beforeunload` + Tauri `on_window_event`).
  - Snapshot after any **bulk operation** (import, year-end, restore).
  - Keep-forever policy already enforced; add rolling **daily / weekly / monthly** tiers (deduped by content hash — no size blow-up, no deletion).

### 5. Cross-profile discovery (the real July fix for future users)
On launch, scan known WebView profile locations:
- `%LOCALAPPDATA%\com.smartaccountant.app\EBWebView\` (pinned, new default)
- `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\IndexedDB\` (legacy)
- Any sibling `EBWebView*` folder under the app root.
If a non-pinned profile contains a larger IndexedDB than the pinned one → silent migration (copy leveldb files across before app opens the DB), log to `<root>/logs/migration-<date>.log`. User sees toast: "Recovered data from previous install location."
Tauri side: new command `discover_and_migrate_webview_data` invoked in `setup()` before window build.

### 6. Data Health page (`src/routes/app.data-health.tsx`)
Read-only diagnostics: manifest vs live counts per company, last snapshot per company, last integrity check, last auto-restore event, one-tap "Verify all now". No destructive actions.

### 7. Tests
- `auto-restore.test.ts` — matrix: OK / empty / shrunk / no-manifest / bad-snapshot fallback.
- `integrity.test.ts` — manifest updates on write, atomic file swap.

## Technical Notes

- Everything client-side, no server calls (respects local-only-mode rule).
- Auto-restore runs inside `checkUpdateSafety()` chain in `src/lib/update-safety.ts`; `UpdateRecoveryBanner` becomes fallback only when auto-restore itself fails.
- Rust side (`src-tauri/src/lib.rs`): add pre-window migration step; keeps pinned `data_directory` invariant.
- Memory: new constraint `auto-restore-silent.md` — "Data recovery must not prompt the user when a valid snapshot exists."

## Files

New:
- `src/lib/integrity.ts`
- `src/lib/auto-restore.ts`
- `src/routes/app.data-health.tsx`
- `src-tauri/src/webview_migrate.rs` (+ command wiring)
- `.lovable/memory/constraints/auto-restore-silent.md`
- tests

Edited:
- `src/lib/update-safety.ts` (invoke auto-restore before banner)
- `src/lib/save-queue.tsx` (bump manifest on flush)
- `src/lib/auto-snapshot.ts` (shutdown + post-bulk triggers, tiered dedup)
- `src-tauri/src/lib.rs` (call migration in setup)
- `src/routes/app.tsx` (mount Data Health link; toast on auto-restore)
- `.lovable/memory/index.md`

## Out of Scope
- Cloud sync of business data (permanently forbidden by memory rule).
- Any prompt-driven recovery when a clean snapshot exists.
