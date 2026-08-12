# Smart Accountant — Legacy Electron 22 Build (Win 7 / 8 / 10 / 11)

Standalone installer for **Windows 7 SP1, 8, 8.1, 10, 11** in both **32-bit
and 64-bit**. Fully offline. Zero effect on the modern Tauri build in
`src-tauri/` — this folder is completely separate.

## What it produces

Two NSIS installers in `electron-legacy/out/`:

- `SmartAccountantSetup-Win7-<version>-ia32.exe` — for 32-bit Windows (Win 7 32-bit)
- `SmartAccountantSetup-Win7-<version>-x64.exe`  — for 64-bit Windows (Win 7 64-bit through Win 11)

Ship the appropriate `.exe` to each client. Both are ~90 MB, install per-user
(no admin needed), create a Desktop + Start Menu shortcut, and register a
proper uninstaller in Add/Remove Programs.

## Why Electron 22

Electron **22.3.27** is the last release that officially supports Windows
7 SP1 / 8 / 8.1 on both ia32 and x64. It bundles Chromium 108. It is no
longer receiving Chromium security patches — this is a deliberate,
documented trade-off to reach old client machines.

Data lives in Electron's per-user `userData` folder
(`%APPDATA%\SmartAccountant\`) as IndexedDB — fully offline, and preserved
across upgrades/reinstalls because `deleteAppDataOnUninstall: false`.

## One-time setup (on any Windows 10/11 build PC)

1. Install **Node.js 18+**  — https://nodejs.org/en/download
2. Place `app.ico` (256×256 Windows icon) at
   `electron-legacy/assets/app.ico`.

That's it. No NSIS install needed — electron-builder ships its own.

## Build the installers

From a Windows command prompt in the project root:

```
build-legacy.bat
```

The script will:

1. Run `npm ci && npm run build:legacy` at the project root
   (uses `--base=./` so `file://` paths resolve inside Electron).
2. Copy `dist/` into `electron-legacy/app/`.
3. `cd electron-legacy && npm ci && npm run dist:win`
4. Emit both installers in `electron-legacy/out/`.

Ship the appropriate `.exe`. Clients double-click → Next → Finish → done.

## Updating existing clients

Because business data lives in `%APPDATA%\SmartAccountant\` and the
installer's `deleteAppDataOnUninstall` is **false**, every future release
is delivered as a new `SmartAccountantSetup-Win7-*.exe` — client double-clicks
it, existing accounting data is preserved automatically. No separate patch
pipeline, no server needed.

Bump `version` in both `package.json` (root) and `electron-legacy/package.json`
before each release so Add/Remove Programs reflects the new version.

## What this build does NOT include

- Windows XP support (Electron 22 requires Win 7 SP1 minimum).
- Auto-update from a server (deliberate — clients may be offline for months).
- Code signing (add an EV cert later to remove SmartScreen warnings).
