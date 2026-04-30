# Why nothing was restored

Your uploaded file `123456.rar` is a **WinRAR archive** (~18 MB), confirmed by its file signature (`Rar!...`).

The app's **Restore from Backup** feature only accepts **`.json`** files produced by its own **Export full backup (.json)** button (see Housekeeping → Backup & Restore). It reads JSON text and validates a specific schema (`schema_version: 1`, with `ledgers`, `vouchers`, `voucher_entries`, etc.).

A `.rar` file is:
- Not JSON (it's compressed binary), so parsing fails immediately.
- Not even one file — RAR is a container that may hold many files inside.
- Likely **not a YourMehtaji backup at all** — our Export feature has never produced `.rar`. This looks like a Tally/Busy/manual archive of documents.

That's why the restore silently produced nothing usable.

---

## What you can do

### Option A — You have the original JSON backup somewhere
Locate the file produced earlier by **Housekeeping → Export full backup (.json)**. On the desktop app it's saved at:
```
Documents\YourMehtaji\Exports\<Company>\backups\*.json
```
Upload that `.json` file in **Housekeeping → Restore from Backup** and it will restore correctly.

### Option B — The .rar contains a JSON backup inside
If you (or someone) zipped a `.json` backup into a `.rar`, extract it first using **WinRAR / 7-Zip** on Windows, then upload only the `.json` file inside.

### Option C — The .rar is Tally/Busy data (not our backup)
If the archive contains Tally/Busy export files (XML, CSV, Excel), those need the **Tally/Busy Import** tool in Housekeeping, not Restore. You'd extract the archive first and feed each file (Day Book CSV, Ledger Master, etc.) into the corresponding importer.

---

## Optional improvement to the app (needs your approval to build)

I can make Restore **fail more clearly** so this doesn't waste your time again:

1. **Detect non-JSON files early** — if the uploaded file isn't `.json` or doesn't start with `{`, show a toast like:
   > *"This file is not a valid YourMehtaji backup. Restore only accepts the .json file from Export full backup."*
2. **Detect archive formats** (RAR/ZIP/7z by magic bytes) and show:
   > *"Archive detected. Please extract the .json backup file from this archive first, then upload it."*
3. Add a tiny help line under the file picker: *"Only .json files exported from this app are supported."*

---

## What I need from you

Please reply with one of:
- **"I have the JSON file"** — and upload it; I'll confirm restore works.
- **"It's inside the RAR"** — extract on your PC and upload the `.json`.
- **"It's Tally/Busy data"** — I'll guide you to the right importer.
- **"Add the clearer error messages"** — I'll implement the Restore validation improvements above.
