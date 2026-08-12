---
name: Frozen Tauri identity
description: Identifier, WiX upgradeCode, and WebView data_directory are frozen forever — changing any orphans user IndexedDB.
type: constraint
---
Do NOT change any of these:
- `identifier` in `src-tauri/tauri.conf.json` → `com.smartaccountant.app`
- `bundle.windows.wix.upgradeCode` → `F7E5A1C2-4B6D-4C8A-9F2E-1A3B5C7D9E11`
- `bundle.windows.nsis.deleteAppDataOnUninstall` → `false`
- WebView2 profile path pinned in `src-tauri/src/lib.rs` to
  `<local_data_dir>/EBWebView` (subdir constant `WEBVIEW_SUBDIR`).

Changing any of these makes WebView2 open a brand-new empty profile on the
next launch and orphans every user's live IndexedDB (companies, vouchers,
ledgers, items, settings). The `snapshots\` folder survives because it uses
its own fixed path, but the live DB is lost.

**Why:** the July 2026 data loss incident was caused by an unpinned WebView
profile path. These pins prevent recurrence.
