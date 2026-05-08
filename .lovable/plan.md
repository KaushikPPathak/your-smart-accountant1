
# Make Your Mehtaji Work Fully Offline

Today the Electron shell just loads the hosted website (`APP_URL` in `electron/main.cjs`) and every read/write hits Lovable Cloud. To run with **no internet at all**, three things must change: the UI must be bundled inside the installer, the database must move from Lovable Cloud to a local file on the PC, and login + backups must work without any server.

This is a large change — roughly the size of the original build. I recommend doing it in clearly separated phases so each phase is testable on its own and you can keep using the cloud version in parallel until the desktop build is proven.

---

## Phase 1 — Bundle the web UI inside Electron (1 small step)

Today, opening the desktop app without internet shows a blank window because it loads `https://biz-account-hero.lovable.app`.

- Build the React app (`vite build`) and ship the `dist/` folder inside the installer.
- Change `electron/main.cjs` to `win.loadFile('dist/index.html')` instead of `win.loadURL(APP_URL)`.
- Set `base: './'` in `vite.config.ts` so assets resolve under `file://`.
- Update the GitHub Windows installer workflow to run `vite build` before packaging.

After Phase 1: the UI opens offline, but data still needs internet. This is the safe checkpoint.

## Phase 2 — Replace Lovable Cloud with a local SQLite database (the big one)

This is the heart of "fully offline". Lovable Cloud (Postgres + RLS + auth + storage + edge functions) is replaced with equivalents that live on the user's PC.

**Local database**
- Add `better-sqlite3` (native Node module, runs inside Electron's main process). One file per installation: `%USERPROFILE%\Documents\YourMehtaji\data\mehtaji.db`.
- Recreate the current schema (companies, company_members, ledgers, items, vouchers, voucher_entries, period_locks, monthly_balances, etc.) as SQLite tables.
- Port the SECURITY DEFINER functions (`next_voucher_number`, `recompute_monthly_balances`, `is_period_locked`, `lock_period`, `unlock_period`, `verify_company_password`, `set_company_password`) into TypeScript helpers that run in the Electron main process.

**Replace the Supabase client**
- Add a thin `localDb` IPC layer in `electron/preload.cjs` exposing `query`, `insert`, `update`, `delete`, `rpc`.
- Create a new `src/integrations/local/client.ts` that mimics the small subset of the Supabase JS API the app actually uses (`from().select().eq()`, `.insert()`, `.update()`, `.rpc()`). The rest of the app keeps importing a single `supabase` symbol — only this file changes.
- Period-lock enforcement (currently DB triggers) moves into the same helper functions, called before every voucher write.

**Drop server functions**
- `src/lib/tech-user.functions.ts`, `gstin-lookup.functions.ts`, `setu.functions.ts` and any `*.functions.ts` go away or run locally. GST verification (AppyFlow) is the only piece that genuinely needs internet — it gets a "requires internet" badge and is skipped when offline.

After Phase 2: everything (companies, ledgers, vouchers, reports, GST books, BRS, backup/restore JSON) works on a laptop in airplane mode.

## Phase 3 — Multi-user login on the same PC (no internet)

Each Windows account using the app gets its own login inside the app, independent of Windows itself.

- New SQLite tables: `local_users(id, username, full_name, password_hash, role, created_at)` and `local_user_company_access(user_id, company_id, role)`.
- Login screen at startup: username + password, hashed with `bcryptjs` (pure JS, works in Electron). First run creates an admin.
- The app still shows the company picker after login, but only companies the user has access to.
- Roles map to the existing `admin / accountant / viewer` model already used in `company_members`.

After Phase 3: one installation can be shared by, e.g., the proprietor and a junior accountant on the same desktop.

## Phase 4 — Optional cloud-drive backup (Google Drive / OneDrive / Dropbox)

This is **backup only** — not sync. The local SQLite file is always the master.

- Reuse the existing JSON backup (`buildCompanyBackup` in `src/lib/backup.ts`) plus a copy of the raw `mehtaji.db` file.
- A new "Cloud Backup" panel in Housekeeping with three providers:
  - **Google Drive** — OAuth via the system browser, then upload to an app folder. Works fully offline-installable but requires internet at the moment of backup.
  - **OneDrive (Hotmail/Outlook account)** — Microsoft Graph upload, same pattern.
  - **Plain folder** — point at any synced folder (Dropbox, iCloud Drive, a USB stick). No OAuth needed; simplest option and works for any provider.
- Schedule: manual button + optional "auto-backup nightly when online".
- Restore: download the latest backup from the chosen provider and import via the existing restore flow.

OAuth credentials for Google/Microsoft need to be created once in their developer consoles; I'll walk you through that when we get to this phase.

## Phase 5 — Migrate existing cloud data to the desktop install

One-time migration so you don't lose the work already in Lovable Cloud.

- In the current cloud app: **Housekeeping → Backup** to produce the JSON file (already exists).
- In the new desktop app: **Housekeeping → Restore from cloud backup** — picks up that JSON and writes it into the local SQLite DB.
- After verifying the desktop copy looks correct, you can stop using the cloud version.

---

## What the user sees at the end

- A `YourMehtaji-Setup-x.y.z.exe` installer (already produced by the GitHub workflow).
- After install: login screen → company picker → the same accounting app you have today, working with no internet.
- A "Cloud Backup" tile in Housekeeping with Google / OneDrive / folder options.
- A "Users" tile (admin only) for adding co-workers on the same PC.

## Recommended order of work (one chat per phase)

1. Phase 1 — bundle the UI (small, ~1 message).
2. Phase 2 — local SQLite + client shim (largest; will need 3–5 follow-up messages because the schema and every read/write path is touched).
3. Phase 3 — local users.
4. Phase 4 — cloud backup providers (Google first, then OneDrive, then folder).
5. Phase 5 — one-time data migration from your current cloud account.

If you approve, I'll start with **Phase 1** in the next message so you have an offline-loading shell to test immediately, then we'll move to Phase 2.

## Technical notes (for reference, not required reading)

- SQLite via `better-sqlite3` is synchronous, fast, and ships as a prebuilt binary for Windows x64 — `@electron/packager` handles it.
- The Supabase JS surface used by the app is small (mostly `.from().select/insert/update/delete`, a handful of `.rpc(...)`, and `auth.getUser`). A 300-line shim is enough; no app component needs to change its imports.
- DB triggers don't exist in SQLite the same way; we'll enforce period locks and auto-timestamps in the helper layer instead. The current cloud project also has zero triggers (per `<db-triggers>`), so behaviour stays identical.
- `LOVABLE_API_KEY`, `APPYFLOW_GST_API_KEY` and other server secrets stop being needed except for the optional GST verification call, which can read a key entered once in Settings.
- Storage bucket `company-logos` becomes a local folder under `%USERPROFILE%\Documents\YourMehtaji\logos\`.
