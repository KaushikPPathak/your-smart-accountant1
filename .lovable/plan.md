
# Recovery + root-cause fix for the 25/02/2026 vs 31/03/2026 issue

## What actually happened (confirmed from your screenshots)

1. **Snapshots folder does not exist on disk.** `C:\Users\Kaushik\AppData\Local\com.smartaccountant.app\snapshots` returns "Windows cannot find". `runAutoSnapshotOnce()` catches every error silently, so the app kept marking companies "Healthy" (manifest-only) while writing nothing to disk. Auto-restore then correctly reported *"no-snapshot, 48 vouchers missing (expected 73)"*.
2. **Two local companies both named "Shri Montu Ramanath Das".** Data Health shows `L16·V138` (manifest V138) and `L15·V131` (manifest V99 — meaning 32 vouchers were added *after* the last manifest snapshot). Your Feb 26 → Mar 31 entries are in one of these two ids; the picker probably keeps opening the other one, so the UI looks like data ends on 25/02/2026.
3. Auto-dedupe was designed to only delete duplicates with **zero** business rows, so both survived and coexisted quietly.

Nothing has been deleted. Recovery is a merge, not a rebuild.

## Part 1 — Recover your books today

Add a new **Housekeeping → Merge duplicate companies** screen:

- Lists company pairs with the same normalised name.
- For the selected pair, shows a side-by-side breakdown: voucher-count per month, earliest/latest voucher date, ledger counts, item counts.
- You pick the "keep" id (the one with the correct Party master history — usually the older one) and the "merge from" id.
- On confirm, it:
  1. Takes a **safety snapshot** of BOTH company payloads to `%LOCALAPPDATA%\com.smartaccountant.app\snapshots\<today>\pre-merge_<name>_<id>.json` for each side (so this operation itself is reversible).
  2. Re-parents vouchers, voucher_entries, voucher_items, bill_allocations, einvoice_details, export_details, period_locks from the "merge from" id to the "keep" id.
  3. For ledgers/items with the same name in both, keeps the "keep" side and rewrites references from the loser side to it. For names that exist only on the loser side, re-parents them.
  4. Deletes the now-empty loser row from `companies` and `cache_companies`.
  5. Refreshes the integrity manifest for the survivor.
- After merge, the survivor should read `V ≈ 138 + (131 − overlap)` and the date range should extend to 31/03/2026.

I will NOT auto-merge on startup. This is user-driven and shows a preview screen first — the exact opposite of the silent path that got us here.

## Part 2 — Stop silently failing to write snapshots

Two fixes:

1. `runAutoSnapshotOnce()` currently wraps the whole per-company block in `try { … } catch { /* silent */ }`. Change it so that any **directory-creation or file-write failure** is (a) recorded to the auto-restore events log, (b) surfaced in Data Health as a red **"Snapshot write failing"** badge on every row, and (c) shown as a one-time toast on launch. The daily gate (`RUN_KEY`) is not set until at least one company writes successfully.
2. Before the first write of the day, actively `mkdir` the `snapshots/<YYYY-MM-DD>` path via the Tauri fs plugin and verify it exists. If creation fails (permissions, antivirus, disk full), report the exact OS error to the user instead of turning the failure into "Healthy".

## Part 3 — Stop the duplicate-company creation

Root cause of the two "Shri Montu Ramanath Das" rows: after fresh install with no snapshot on disk, opening the create-company flow doesn't check whether a local company with the same normalised name already exists.

Add a guard in the "Create company" path:
- Normalise the entered name (trim + collapse whitespace + lowercase).
- Query `cache_companies` and `companies` for any existing row with the same normalised name.
- If a match is found, block creation and offer three options: **Open existing**, **Merge into existing after opening**, or **Create anyway (with distinct suffix)**. Never silently create a second row with an identical name.

Also strengthen `dedupeLocalCompaniesOnce()`: if two rows share a name AND both have business rows, don't delete — but do publish an event that the Data Health screen surfaces as a **"Duplicate name — needs merge"** amber row with a direct link to the merge screen.

## Part 4 — Make Data Health honest

- Row status downgrades to amber when **the manifest count is stale relative to live** (your V131 vs manifest V99 case) instead of showing "Healthy".
- Row status downgrades to red when **no snapshot file exists on disk** for that company, regardless of manifest.
- Duplicate-name rows are grouped together with a "Merge these" action.

## Part 5 — Verify before shipping

- Vitest: merge algorithm on a synthetic pair of companies (overlapping ledgers, non-overlapping vouchers) preserves every voucher and every posting; totals balance before and after.
- Vitest: `runAutoSnapshotOnce()` bubbles up a specific error state when the target directory can't be created.
- Playwright: create-company guard rejects a duplicate name and offers the "Open existing" path.

## What I will not do

- I will not auto-merge your two companies without you approving the preview.
- I will not delete either duplicate row until vouchers have been safely re-parented and both sides have a fresh snapshot on disk.
- I will not change your Tauri identifier / WiX upgrade code / WebView profile path (the frozen-identity constraint).

## Technical notes

- New file: `src/routes/app.housekeeping.merge-companies.tsx` + `src/lib/merge-companies.ts` (pure logic, unit-tested).
- New file: `src/lib/snapshot-diagnostics.ts` recording per-run write outcomes into `offlineDb.meta` under `snapshot_run_events`.
- Modified: `src/lib/auto-snapshot.ts` (explicit mkdir + error propagation), `src/components/data-health/FieldIntegrityPanel.tsx` (new columns and badges), `src/routes/app.companies.tsx` (duplicate-name guard on create).
- Migration of duplicates uses Dexie transactions across `cache_vouchers`, `cache_voucher_entries`, `cache_voucher_items`, `cache_bill_allocations`, `cache_einvoice_details`, `cache_voucher_export_details`, `cache_period_locks`, `cache_ledgers`, `cache_items`.
- No server / RLS changes — this is all local IndexedDB and local disk.

## Order of implementation

1. Merge tool (Part 1) — you can recover today.
2. Snapshot honesty + directory guarantee (Part 2) — prevents the next incident.
3. Duplicate-name creation guard (Part 3).
4. Data Health status changes (Part 4).
5. Tests (Part 5).

Approve this and I'll start with Part 1 so you can run the merge tonight.
