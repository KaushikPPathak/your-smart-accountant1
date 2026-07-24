# Legacy Installer — Update Plan

How to ship new versions to clients on Win XP / 7 / 8 who installed via
`SmartAccountantSetup-Legacy-<version>.exe`. The modern Tauri auto-updater
(used by Win 10/11 clients) does **not** apply here — old Windows can't run it.

## Guiding principles

1. **Client data is sacred.** Updates never touch `%LOCALAPPDATA%\SmartAccountant\profile\`.
   The NSIS uninstaller already preserves the profile folder by design.
2. **Zero client technical work.** Every update is a single double-click .exe.
3. **Offline-friendly.** Client machine may be offline for months. Updates
   are delivered by USB / email / WhatsApp when convenient.
4. **Version-in-name.** Filename always encodes version so clients and
   support staff can tell what's installed.

## Three-tier update strategy

### Tier 1 — In-app patch (app files only, ~5-15 MB)

Use for 90% of releases (bug fixes, feature changes, GST rule updates).
Only the web bundle (`dist/`) changes; Supermium stays as-is.

Ship: `SmartAccountantPatch-<version>.exe` — a tiny NSIS installer that
only replaces `%LOCALAPPDATA%\SmartAccountant\app\`. Build target to be
added as `patch.nsi` alongside `installer.nsi`. Client double-clicks,
Next-Finish (~10 seconds), relaunches shortcut.

### Tier 2 — Full reinstall (app + browser, ~180 MB)

Use when Supermium itself must be upgraded (security fix, new Chromium
features required). Re-run `build-installer.bat` — output overwrites app
and browser, keeps profile. Client double-clicks the same-named installer.

### Tier 3 — Data migration release (schema change)

When IndexedDB schema changes:
- Ship as Tier 1 or Tier 2, but the app itself runs migrations on next
  launch (already handled by the app's local-only migration layer).
- Add a **pre-update banner** in the app one release earlier warning
  clients to take a manual backup (they already have the Backup button
  in the top bar — the coffee-B icon).

## In-app update awareness (already partly built)

The app already reads `import.meta.env.VITE_APP_VERSION`. Add a small
"Check for updates" banner on the About screen that:

- Fetches `https://<your-domain>/legacy/latest.json` on demand (only when
  the client clicks "Check now" — never auto, respects offline).
- Compares version, shows download button pointing at the latest
  `SmartAccountantPatch-*.exe` URL.
- Never blocks the app if offline / server unreachable.

`latest.json` schema (host on any static server / Cloudflare R2):

```json
{
  "latest_version": "1.2.3",
  "min_supported_version": "1.0.0",
  "patch_url": "https://.../SmartAccountantPatch-1.2.3.exe",
  "full_url":  "https://.../SmartAccountantSetup-Legacy-1.2.3.exe",
  "notes_url": "https://.../release-notes.html",
  "released_at": "2026-08-01"
}
```

## Release checklist (for you)

1. Bump `APP_VERSION` in `legacy-installer/installer.nsi` and (later) `patch.nsi`.
2. Bump `version` in `package.json` (keeps `VITE_APP_VERSION` in sync).
3. On Windows build PC: run `build-installer.bat`.
4. Test on a real Win 7 VM: install → open → verify existing profile intact.
5. Upload the .exe + updated `latest.json` to your download host.
6. Notify clients (WhatsApp broadcast / email) with the download link.

## Client support cheat-sheet

- **App won't open after update** → uninstall + reinstall latest full setup.
  Their data survives (profile preserved).
- **Wants clean slate** → uninstall, then manually delete
  `%LOCALAPPDATA%\SmartAccountant\profile\`, then reinstall.
- **Wants to move to a new PC** → export via the in-app Backup button,
  install on the new PC, restore via Restore button. (Works because
  business data is IndexedDB inside the Supermium profile — no OS
  registry entries hold data.)

## What NOT to promise clients

- Do not promise silent background updates on XP/7. Chromium's own updater
  can't run there. Every legacy update is a manual double-click.
- Do not promise data sync across machines from the legacy build. That
  requires cloud, which is opt-in and separate.
