# Project Memory

## Core
Never compare the product to Tally, Busy, or any other named accounting software (licensing/legal risk). Describe behaviors generically.
Voucher header field order: Date → Party → Reference No → Place of Supply.
Manufacturing Journal posts GL: Dr Finished Goods / Cr Raw Materials (auto-created under STOCK_IN_HAND) for total consumption value, plus inventory moves via voucher_items.
Local-only data ownership: all business data stays in local IndexedDB on that device forever. Business data (companies, vouchers, ledgers, items, settings, all *_cache tables) is NEVER pushed to our servers. Only auth (login/profile) uses the cloud. Sync worker + outbox drain + snapshot pull are short-circuited by `isLocalOnlyMode()` in src/lib/local-only-mode.ts (default true). Cloud backup is opt-in per user to THEIR OWN Google Drive/OneDrive/Dropbox — never our servers. Never re-introduce automatic server sync of business data.
Local backups/snapshots are PERMANENT. Never add prune/rotate/TTL against `%LOCALAPPDATA%\com.smartaccountant.app\snapshots\` or `\backups\`. Only the user deletes their files.
Tauri identity is FROZEN: `identifier=com.smartaccountant.app`, WiX `upgradeCode=F7E5A1C2-4B6D-4C8A-9F2E-1A3B5C7D9E11`, WebView profile pinned to `<local_data_dir>/EBWebView` in src-tauri/src/lib.rs, NSIS `deleteAppDataOnUninstall=false`. Changing any orphans user IndexedDB.

## Memories
- [Local data is permanent](mem://constraints/local-data-permanent) — no auto-delete of user backups/snapshots ever
- [Frozen Tauri identity](mem://constraints/frozen-tauri-identity) — identifier, upgradeCode, WebView data_directory must never change
