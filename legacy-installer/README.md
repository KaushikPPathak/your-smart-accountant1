# Smart Accountant — Legacy Windows Installer

Standalone installer for **Windows XP SP3, Vista, 7, 8, 8.1** (also runs fine on 10/11
if a client insists on a single build). Modern Win 10/11 clients continue to use
the Tauri build in `src-tauri/`. **This folder does not touch the Tauri pipeline.**

## What it produces

`SmartAccountantSetup-Legacy-<version>.exe` — a single ~180 MB NSIS installer that:

1. Extracts **Supermium** (portable Chromium fork, supports XP → Win 11) into
   `%LOCALAPPDATA%\SmartAccountant\browser\`.
2. Extracts your **built web app** (`dist/`) into `%LOCALAPPDATA%\SmartAccountant\app\`.
3. Creates a Desktop + Start Menu shortcut that launches:
   `browser\supermium.exe --app=file:///.../app/index.html --user-data-dir=...`
4. Registers a proper uninstaller in Add/Remove Programs.

All accounting data stays in the per-user Supermium profile
(`%LOCALAPPDATA%\SmartAccountant\profile\`) via IndexedDB — nothing is
sent to any server. Fully offline after install.

## One-time setup (on any Windows 10/11 build PC)

1. Install **NSIS 3.x** — https://nsis.sourceforge.io/Download
2. Install **Node.js 18+** (for `npm run build`)
3. Download **Supermium portable ZIP** (32-bit for XP compatibility) from
   https://win32subsystem.live/supermium/ and unzip into
   `legacy-installer/vendor/supermium/` (so `supermium.exe` sits at
   `legacy-installer/vendor/supermium/supermium.exe`).

## Build the installer

From a Windows command prompt in the project root:

```
build-installer.bat
```

The script will:
- Run `npm ci && npm run build` (produces `dist/`)
- Copy `dist/` into `legacy-installer/staging/app/`
- Copy Supermium into `legacy-installer/staging/browser/`
- Invoke `makensis installer.nsi`
- Output `SmartAccountantSetup-Legacy-<version>.exe` in `legacy-installer/out/`

Ship that single `.exe` to clients on old machines. They double-click → Next →
Finish → done. Works offline forever after that.

## Update process for older-system clients

See `UPDATE-PLAN.md` in this folder.
