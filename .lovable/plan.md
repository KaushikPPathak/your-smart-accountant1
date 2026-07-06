# Local-First Data Ownership

Shift the app from a cloud-primary model to a **device-local primary** model. Business data never lives on our servers again. Users optionally back up to their own cloud storage.

## Scope

All platforms — Windows (.exe), Android (.apk), and Web. Same behavior everywhere. Auth (login/signup) still uses Lovable Cloud so users can identify themselves across their own devices, but no business data is written to our server.

## What stays on the server

- `auth.users` (email/password so the user can sign in on a fresh install)
- `profiles` (display name / avatar only)
- `app_users` (license / plan info)

## What moves to local-only IndexedDB (per device)

Every table currently holding company data:
companies, company_members, company_settings, ledgers, ledger_group_mappings, account_group_overrides, account_subgroups, items, vouchers, voucher_items, voucher_entries, voucher_export_details, voucher_number_seq, voucher_repair_audit, bill_allocations, bom_templates, bom_template_lines, bank_statements, bank_statement_lines, gst_api_credentials, gstr2b_imports, gstr2b_lines, gstr3b_inward_summary, gstr3b_itc_reversal, einvoice_details, einvoice_api_log, it_43b_clearances, it_asset_blocks, it_asset_movements, it_disallowances, it_fixed_assets, monthly_balances, closing_runs, period_locks, period_lock_audit, entity_members, import_batches, payment_reminders, recurring_invoices.

## Implementation

### 1. Local DB layer (Dexie / IndexedDB)
- Add a Dexie schema mirroring every table above, keyed by the same UUIDs.
- All existing repository / query hooks are refactored to read/write Dexie directly instead of Supabase.
- Kill the "outbox sync" worker — nothing syncs to our server anymore.
- Data is scoped per `(deviceId, authUserId)` so multiple accounts on the same PC stay separate.

### 2. One-time migration down
- On first launch of the new version, if the signed-in user has data on the server, download it into local Dexie in one pass, then issue a server-side purge for that user.
- Show a small "Preparing your local data…" screen while it runs. Idempotent — safe to re-run.

### 3. Server-side wipe
- Migration that drops RLS-write policies on all business tables (server becomes read-only during the transition window).
- Backend server function `purgeMyCloudData()` that deletes all rows owned by `auth.uid()` across the business tables. Called by step 2.
- Once all active users have migrated (or after a grace period the user chooses in a follow-up), we can drop the tables entirely.

### 4. User-owned cloud backup (opt-in, per user)
Settings → Backup panel with three provider tabs:
- **Google Drive** — user connects their own Google account via OAuth, we store the refresh token locally (encrypted with a device key). Backups written to an app-specific folder in *their* Drive.
- **Dropbox** — same pattern, Dropbox OAuth.
- **OneDrive** — same pattern, Microsoft OAuth.
- **Manual file** — download an encrypted `.laccbak` file, or restore from one.

Backup format: single encrypted JSON blob (AES-GCM, key derived from the user's password via PBKDF2). Contains a full Dexie snapshot. Restore replaces local DB.

Schedule options: Manual, Daily, Weekly. Runs silently in background when online.

**Critical:** the OAuth tokens and backup contents live on the user's device and in the user's own cloud account only — never on our servers.

### 5. Multi-device story
Since data is per-device, moving to a new PC = "Restore from my Google Drive backup" on first launch. We surface this clearly on the empty-state of a fresh install.

## Technical Notes

- Dexie v4 for IndexedDB; existing TanStack Query keys stay the same, just point at Dexie-backed fetchers.
- Encryption via WebCrypto `SubtleCrypto` — works in browser, Tauri, and Android WebView.
- Google Drive / Dropbox / OneDrive integrations use per-user OAuth (not workspace connectors) since each end-user connects their own account. We'll register OAuth app IDs for each provider.
- Existing offline-first outbox code is removed; the memory rule "offline-first via outbox" is superseded by "local-first, no server sync at all".
- Web build: same Dexie DB, scoped per browser. Users on web get the same "back up to your own Drive" story.

## Migration Order (what I'll ship)

1. Add Dexie schema + repository layer, dual-write behind a feature flag.
2. Ship the migration-down + server purge flow.
3. Flip reads to Dexie-only, remove Supabase business-data writes.
4. Ship the backup/restore UI with manual-file first, then Google Drive, then Dropbox/OneDrive.
5. Update the memory rule about offline-first outbox.

This is a multi-turn effort. I'll do it in the order above so nothing breaks between steps — approve the plan and I'll start with step 1.
