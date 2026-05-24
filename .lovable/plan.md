## Goal

Make the Windows desktop app safe across upgrades:
1. All local user data (backups, transaction snapshots, app state) lives **only** under the OS-standard per-user app data folder.
2. Reinstalling/upgrading the `.exe` replaces program files **only** — it never touches the user data folder.
3. If the local file layout or schema changes between versions, the app silently migrates on launch instead of wiping anything.

## Today's situation

- `src/lib/local-mirror.ts` + `saveCompanyFileNative()` (in `src/lib/native-bridge.ts`) write per-company JSON snapshots. On Tauri the base is already `appDataDir()/Exports/<Company>/{backups,latest}/` ✅
- BUT some flows (older Electron path, `Documents\YourMehtaji\...` references) still target the user's Documents folder.
- `src-tauri/tauri.conf.json` uses NSIS + MSI with `installMode: "perMachine"` but does not explicitly declare the data directory or upgrade behavior, so a reinstall could theoretically clobber adjacent files.
- There is no `app_data_version` marker file and no migration runner — if we ever rename a folder or bump the JSON schema, old installs will silently break.

## Plan

### 1. Single source of truth for the data root

Add `src/lib/app-paths.ts`:
- `getAppDataRoot()` → `appLocalDataDir()/SmartAccountant/` on Tauri, Electron equivalent (`app.getPath('userData')`) for the legacy bridge, browser → `null`.
- Sub-roots: `backups/`, `exports/`, `mirror/<companyId>/`, `state/`, `logs/`.
- Export a typed `AppPaths` object so every caller goes through one place.

Refactor callers to use it:
- `src/lib/native-bridge.ts` → `saveCompanyFileNative()` writes under `appLocalDataDir()` (switch from `appDataDir()` → `appLocalDataDir()`, which is the per-user, non-roaming, installer-untouched location on Windows: `%LOCALAPPDATA%\com.smartaccountant.app\`).
- `src/lib/local-mirror.ts`, `src/lib/backup.ts`, `src/lib/desktop-save.ts`, `src/components/housekeeping/BackupRestoreTool.tsx` → use `AppPaths.*` instead of hard-coded `Exports/` strings or `Documents\YourMehtaji`.
- Keep "Save as…" picker (user-chosen path) unchanged — that's an explicit user action.

### 2. Lock Tauri's filesystem scope to the data root only

Edit `src-tauri/capabilities/default.json`:
- Drop the broad `$DOCUMENT/**`, `$DOWNLOAD/**`, `$DESKTOP/**`, `$HOME/**`, `$APPDATA/**`, `$APPCONFIG/**` entries from the always-on scope.
- Keep only `$APPLOCALDATA/**` for silent writes.
- Add a second capability file `capabilities/user-picker.json` scoped to the dialog-chosen path pattern (`fs:allow-write-file` with `$DOWNLOAD/**`, `$DOCUMENT/**`, `$DESKTOP/**`) so the explicit "Save as…" flow keeps working but nothing else can silently write outside `%LOCALAPPDATA%`.

### 3. Configure the Windows installer to preserve user data

Edit `src-tauri/tauri.conf.json` → `bundle.windows.nsis`:
- Add `"displayLanguageSelector": false`.
- Add `"deleteAppDataOnUninstall": false` (NSIS default behavior we want to make explicit).
- Add `"allowDowngrades": false` so older builds can't overwrite newer state.
- Confirm `installMode: "perMachine"` is the right choice — switch to `"both"` (let user pick) or keep `perMachine`; either way Windows writes user data to `%LOCALAPPDATA%\com.smartaccountant.app\`, which NSIS/MSI never touches because it is outside `Program Files`.
- Add `bundle.windows.wix.upgradeCode` (stable GUID) so MSI upgrades are recognized as upgrades (not parallel installs) and the upgrade transaction only replaces Program Files contents.
- Add an `upgrades` block with `"allowSameVersionUpgrades": true` (so re-installing the same build is safe) and remove any `RemoveFile` / `RemoveFolder` directives targeting `%LOCALAPPDATA%`.

Reference layout written by the installer (Program Files area — replaced on upgrade):
```
C:\Program Files\SmartAccountant\
  SmartAccountant.exe
  resources\        ← report layouts, fonts, code assets
```

Reference layout owned by the app at runtime (per-user — NEVER touched by installer):
```
%LOCALAPPDATA%\com.smartaccountant.app\
  app_data_version.json
  backups\
  mirror\<companyId>\
  state\
  logs\
```

### 4. Silent on-launch migration runner

Add `src/lib/app-data-migrations.ts`:
- Constant `CURRENT_DATA_VERSION = 1`.
- On Tauri startup (called from `src/routes/app.tsx` once, gated by `isDesktopRuntime()`):
  1. Read `app_data_version.json` from the data root.
  2. If missing → assume legacy layout. Run `migrateLegacyDocumentsFolder()`:
     - If `Documents\YourMehtaji\Exports\` exists, move (not copy) its contents under `%LOCALAPPDATA%\com.smartaccountant.app\mirror\` preserving company subfolders. Leave a `MOVED.txt` breadcrumb in the old folder.
     - Write `app_data_version.json = { version: 1, migrated_from: "legacy_documents", at: <iso> }`.
  3. If `version < CURRENT_DATA_VERSION` → run ordered migration steps `v1 → v2 → …`. Each step is a pure function with a try/catch; on failure log to `logs/migrations.log` and abort (don't half-migrate).
  4. If `version > CURRENT_DATA_VERSION` → no-op (downgrade) and surface a one-time toast: "This data folder was written by a newer version".
- All steps are idempotent and run silently (no user prompt).

### 5. Tiny diagnostics surface

In `src/components/housekeeping/BackupRestoreTool.tsx` add a read-only "Data folder" line showing the resolved `%LOCALAPPDATA%\com.smartaccountant.app\` path plus a "Reveal in Explorer" button (uses existing `showInFolderNative`). This makes it visible to users that backups live outside Program Files.

## Files touched

- `src-tauri/tauri.conf.json` — NSIS/MSI upgrade-safety settings, stable WiX upgradeCode.
- `src-tauri/capabilities/default.json` — narrow always-on FS scope to `$APPLOCALDATA/**`.
- `src-tauri/capabilities/user-picker.json` — new, scoped to dialog-chosen writes.
- `src/lib/app-paths.ts` — new, single source of truth.
- `src/lib/app-data-migrations.ts` — new, version marker + migration runner.
- `src/lib/native-bridge.ts` — switch base to `appLocalDataDir()`, use `AppPaths`.
- `src/lib/local-mirror.ts`, `src/lib/backup.ts`, `src/lib/desktop-save.ts` — go through `AppPaths`.
- `src/routes/app.tsx` — invoke migration runner once on desktop after login.
- `src/components/housekeeping/BackupRestoreTool.tsx` — show data-folder path + reveal button.

## What does NOT change

- Cloud backend, RLS, server functions, Supabase config — untouched.
- Web version behavior — untouched (it has no filesystem).
- The Backup & Restore JSON format and the "Save as…" picker — unchanged.
- Voucher, ledger, report business logic — unchanged.

## Caveats

- The migration moves files from `Documents\YourMehtaji\Exports\` into `%LOCALAPPDATA%\com.smartaccountant.app\mirror\` exactly once. After migration, the old Documents folder will be empty (with a `MOVED.txt` note). Existing manual backups you placed there yourself are not affected because the migration only touches the `Exports/` subtree the app itself created.
- `%LOCALAPPDATA%` is per-user. If two Windows users on the same PC use the app, each gets their own data folder — same as today, just made explicit.
- Stable WiX `upgradeCode` GUID must be generated once and never changed across releases. I'll add it as a constant in `tauri.conf.json`.
