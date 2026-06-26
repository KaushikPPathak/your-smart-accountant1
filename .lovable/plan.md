# Fix `npm ci` lock-file-out-of-sync error

## Problem

On your Windows PC, `npm ci` aborts with `EUSAGE … package.json and package-lock.json … not in sync`, listing dozens of missing optional native packages (`@napi-rs/canvas-*`, `@tailwindcss/oxide-*`, `@tauri-apps/cli-*`, `@esbuild/*`, `lightningcss-*`, `@rollup/rollup-*`, `fsevents`).

These are all **platform-specific optional dependencies**. The current `package-lock.json` in the repo was generated in an environment where npm pruned them out, so npm on your Windows machine sees them as missing. `npm ci` refuses to "fix" the lock — it only installs exactly what the lock says. That is why `tauri build` then fails: `node_modules` was never populated, so the `tauri` CLI binary isn't on PATH.

The previous regeneration was done with `bun`, which doesn't write npm's `optionalDependencies` cross-platform entries the same way npm 10 expects them.

## Fix

Regenerate `package-lock.json` using npm itself (not bun) with full cross-platform optional metadata, then commit it. After that `npm ci` works on Windows, Linux and macOS.

Steps I will run in the sandbox:

1. Delete the current `package-lock.json` and `node_modules`.
2. Run `npm install --package-lock-only --ignore-scripts` to produce a fresh lock-only file (no install side effects, no Rust/Tauri postinstall hooks).
3. Verify with `npm ci --ignore-scripts --dry-run` that the lock now resolves cleanly with zero "Missing:" entries.
4. Commit the updated `package-lock.json`.

No `package.json` changes, no `--force`, no `--legacy-peer-deps`. Only the lock file is rewritten.

## What you do on Windows after the fix

In your project folder (fresh download or `git pull`):

```powershell
rmdir /s /q node_modules
del package-lock.json   # only if you had a stale one locally
git pull                 # or re-download the zip
npm ci
npm run tauri build
```

`tauri` will now exist at `node_modules\.bin\tauri.cmd` and the build will proceed.

## Why this is the right fix (not "install tauri globally")

`@tauri-apps/cli` is already a devDependency in `package.json`. The reason `tauri` wasn't recognized is purely that `npm ci` aborted before installing anything. Fixing the lock file fixes both errors at once — you do not need to `npm i -g @tauri-apps/cli`.

## Risk / scope

- Touches one file: `package-lock.json`.
- No runtime code changes, no dependency version bumps.
- TanStack 1.170.x alignment from the previous regen is preserved (npm will reuse the same resolved versions from `package.json` ranges).
