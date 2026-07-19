
## What we know now

- Your uploaded backup file (`Shri Montu Ramanath Das`, company id `ef0e4ecd…`) contains **131 vouchers, 264 entries, 15 ledgers, dated 05-Apr-2025 → 25-Mar-2026**. This is your **pre-reinstall, tallied-good** dataset.
- After reinstall you created a second company (`21107b91…`, 138 vouchers, up to 21-May-2026). Some of those 138 are **re-typed duplicates** of Feb–Mar entries; the rest are genuine new entries dated **after 25-Mar-2026**.
- You already ran Merge Companies → the surviving company now holds **both sets combined**, which is why your 31-Mar-2026 bank balance no longer matches.

Restoring the backup alone would lose your genuine post-25-Mar entries. Deleting the merged company alone would lose the pre-reinstall history. We need a controlled reconstruction.

## Recovery plan

### Step 1 — Freeze current state (safety)
- Take a full JSON backup of the current merged company **before touching anything**. Save it outside `%LOCALAPPDATA%`.
- Do not enter any new voucher until Step 5 completes.

### Step 2 — Restore the uploaded backup into a fresh company
- Add a new "Restore backup into new company" action in Housekeeping. It will:
  - Create a new local company row with a suffix (e.g. `Shri Montu Ramanath Das (Restored)`).
  - Import the backup's ledgers, settings, vouchers, entries verbatim under the new company id.
- Result: a clean copy of your 131-voucher / 25-Mar-2026 state.

### Step 3 — Extract genuine post-25-Mar entries from the merged company
- New Housekeeping action "Export vouchers after date":
  - Input: source company = merged one, cutoff = 25-Mar-2026.
  - Output: JSON of vouchers + entries + items whose `voucher_date > 2026-03-25`.
- You review the list on-screen (count by month + type) before exporting.

### Step 4 — Import the post-25-Mar slice into the restored company
- Same tool, "Import vouchers into company":
  - Auto-maps ledger names to the restored company's ledgers.
  - Skips any voucher whose (date + number + type + amount) already exists (defensive).
- Result: restored company now has 131 pre-reinstall vouchers + only the genuine new ones after 25-Mar.

### Step 5 — Verify
- Open **Cash & Bank Book → 31-Mar-2026** on the restored company.
- Compare with your bank tally. If it matches, the restored company becomes the active one and the merged company is renamed `_ARCHIVE_do_not_use` (kept, not deleted, for 30 days).
- If it does not match, we stop and diff against the backup ledger-by-ledger before deleting anything.

### Step 6 — Prevent recurrence
- Duplicate-name guard on company creation (already planned).
- On first launch after reinstall, if a backup file is detected in the default folder, prompt "Restore from backup?" instead of letting you re-enter from scratch.

## Technical notes

- New file: `src/lib/recovery/restore-into-new-company.ts` — parses backup envelope, verifies `checksum_sha256`, inserts into IndexedDB under a fresh `company_id`.
- New file: `src/lib/recovery/date-slice-export.ts` — filters vouchers/entries/items by `voucher_date > cutoff`, resolves ledger names.
- New file: `src/lib/recovery/date-slice-import.ts` — maps ledger names → target company ledger ids, deduplicates on (date, number, type, total).
- New UI: `src/components/housekeeping/RecoveryWizard.tsx` — 5-step wizard mirroring the plan above with a preview before each write.
- No changes to sync/cloud paths; local-only mode remains enforced.

## What I need from you before I start

1. Confirm the plan. I will not delete or overwrite anything in the merged company — it will be renamed to `_ARCHIVE_…` at the end and kept.
2. Confirm the cutoff date **25-Mar-2026** is correct (i.e. everything up to and including 25-Mar in the backup is trustworthy, and anything dated after that in the merged company is the "new" work you want to keep).
