## Goal

Stop writing backups silently into the hidden `%LOCALAPPDATA%` folder. On the desktop app, the **first time** you take a backup the app asks "Where should backups live?" — that path is remembered per company. From then on:

- **Backup** writes straight into that folder (no dialog, no hunt).
- **Restore** opens the file-picker pre-pointed at that folder.
- A **"Change backup folder…"** button lets you move it later (e.g. switch to a OneDrive / pen-drive path).

Browser mode is unchanged (downloads to Downloads).

---

## What changes the user sees

In **Housekeeping → Backup & Restore**:

1. New row at the top of the Export card:
   - **"Backup folder:"** `D:\Accounts\SmartAccountant\Acme Traders\` (with **Open** and **Change…** buttons)
   - If no folder picked yet: **"Not set — click Change… to choose where backups should go."**
2. **Backup now (JSON + Excel)** button keeps its name but now writes silently into that chosen folder (with a `backups/` and `latest/` sub-folder per company, as today).
3. **Save as…** button stays as the "one-off, pick a different location this time" escape hatch.
4. **Restore from Backup** card: the file `<input>` is replaced with a **"Choose backup file…"** button that opens a native file dialog pre-navigated to the saved backup folder. The browser `<input type="file">` remains as a fallback.

---

## Technical plan (skip if you trust me)

### 1. Persist the chosen folder
- Add `getBackupFolder(companyId)` / `setBackupFolder(companyId, path)` in a new `src/lib/backup-location.ts`. Stored in `localStorage` under `ym_backup_folder:<companyId>` so each company can point to its own folder.
- Also a global default key `ym_backup_folder:_default` used when a new company is created.

### 2. Native folder picker (Tauri)
- Add `pickFolderNative()` to `src/lib/native-bridge.ts`, using `@tauri-apps/plugin-dialog`'s `open({ directory: true })`.
- Add `openFilePickerNative(defaultDir, filters)` returning a chosen file path, using `open({ directory: false, defaultPath, filters })`.
- Update Tauri capability `src-tauri/capabilities/user-picker.json` to allow `fs:scope` writes under any path the user explicitly picks. Tauri's dialog plugin already returns user-picked paths; we widen the FS scope by adding a runtime-added scope when a folder is chosen (call `fs.scope.allow(path)` once after selection).

### 3. Wire backup writes to the chosen folder
- Update `writeLocalMirror` in `src/lib/local-mirror.ts`:
  - If a folder is set, write directly to `<chosenFolder>/<Company>/backups/...` and `<chosenFolder>/<Company>/latest/...` using `@tauri-apps/plugin-fs` `mkdir` + `writeTextFile` against the absolute chosen path.
  - If not set, prompt the picker once, save it, then proceed.
- Same fallback path for `exportCompanyBackup` (`src/lib/backup.ts`) so the default **Export full backup** button also honours the chosen folder.

### 4. Wire Restore to open in that folder
- In `BackupRestoreTool.tsx`, add a new "Choose backup file…" button that on desktop calls `openFilePickerNative(chosenFolder, [{ name: 'JSON Backup', extensions: ['json'] }])`, reads the file via `@tauri-apps/plugin-fs` `readTextFile`, and feeds it into the existing `parseBackupFile` → `restoreCompanyBackup` flow. Keep the existing `<input type="file">` visible as a secondary option.

### 5. UI surface
- New `BackupFolderCard` (or inline block in `BackupRestoreTool`) that shows the current folder, **Open**, **Change…**, and a one-liner: *"All backups for this company go here. You can switch to a USB / OneDrive folder any time."*
- Keep the existing `%LOCALAPPDATA%` data-folder card — rename it to **"App data folder (logs, cache)"** so it no longer implies backups live there.

### 6. Migration
- On first run after upgrade, if `%LOCALAPPDATA%\...\mirror\<Company>\backups\` contains files and no chosen folder is set, show a one-time prompt: *"Pick a folder for future backups. Existing backups will stay where they are; you can copy them over manually if you want."* No automatic move (safer).

---

## Out of scope (for this change)

- No automatic cloud sync.
- No scheduled / unattended backups.
- No change to the backup file format or restore logic.
- Electron build is not touched (only Tauri picker added); Electron continues to use its existing IPC.

---

## Risk / notes

- Tauri's FS scope is strict — we must call `fs.scope.allow(chosenPath)` after the user picks the folder; without that, writes outside `%LOCALAPPDATA%` are blocked. This is the one piece that needs careful testing on the first installed build.
- If the user picks a folder on a removable drive (USB) and the drive is missing at backup time, we show a clear error and offer the picker again — we never silently fall back to `%LOCALAPPDATA%` (that's how data gets lost-in-translation).
