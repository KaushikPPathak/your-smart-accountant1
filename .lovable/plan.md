# Offline-resilient layer (no rewrite)

## Goal

Keep Supabase as the source of truth. Add a thin local layer so the app:
- Opens and unlocks (Admin/Staff PIN) with no internet.
- Lets the user read recent data and create vouchers/ledgers/items while offline.
- Auto-pushes queued writes when the connection comes back.
- Keeps GSTIN lookup, e-invoice, AI assistant, multi-device sync untouched (online-only as today).

No accounting logic moves. No tables get renamed. No RPCs get rewritten.

## What gets added

### 1. Local cache (Dexie / IndexedDB) — `src/lib/offline/cache.ts`
Mirror only the per-company data the user actually needs offline:
- `companies`, `company_settings`, `company_members`, `app_users`
- `ledgers`, `items`, `account_subgroups`, `ledger_group_mappings`
- `vouchers`, `voucher_entries`, `voucher_items`, `bill_allocations`
- `period_locks` (so the offline UI can grey out locked dates)
- `monthly_balances` (so reports work offline as a snapshot)

Each row stored with `(id, company_id, updated_at, _local_dirty?)`. Pulled on first online load per company; refreshed in background when online.

### 2. Read-through wrapper — `src/lib/offline/db.ts`
A small wrapper around `supabase.from(table)` that:
- Online → hits Supabase, writes the result into Dexie, returns it.
- Offline → reads from Dexie, returns a `{ data, error: null, offline: true }` shape compatible with current callers.

Used by the heaviest read paths first (vouchers list, ledgers, items, reports). Other reads keep using `supabase` directly and just show a "needs internet" empty state when offline. We **do not** wrap every call site in one go — phased rollout.

### 3. Write outbox — `src/lib/offline/outbox.ts`
A Dexie table `outbox` with one row per pending mutation:
```
{ id, op: 'insert'|'update'|'delete'|'rpc', table?, rpc?, payload, company_id, created_at, attempts, last_error }
```
Writers (`createVoucher`, `updateLedger`, etc.) go through `enqueueWrite()`:
- Online → execute against Supabase, return result, update cache.
- Offline → write to local cache with `_local_dirty=true`, push row into outbox, return optimistic result, show "Saved locally — will sync when online" toast.

A `SyncWorker` (singleton, started by `AuthProvider`) listens to `navigator.onLine` + a periodic ping, and drains the outbox FIFO when connectivity returns. Conflicts surface as a banner in `BackupRestoreTool` (existing housekeeping page).

### 4. RPCs that **must** stay online
`next_voucher_number`, `lock_period`, `unlock_period`, `recompute_monthly_balances`, `sync_opening_balances_from_previous_fy`, `delete_vouchers_bulk`, `delete_import_batch`, GSTIN lookup, e-invoice.

Behaviour offline:
- `next_voucher_number` → local fallback that reads max-suffix from the cached vouchers for that type and appends `-OFFLINE-<n>`. On sync, the server re-issues a clean number and we patch the voucher.
- Everything else (period lock toggles, year-end closure, bulk delete, GSTIN lookup, e-invoice) → button disabled with tooltip "Needs internet".

### 5. Offline-capable PIN unlock — `src/lib/offline/pin-cache.ts`
On every successful online `verify_app_user_pin`, cache:
```
{ user_id, name, role, pin_hash, is_active, cached_at }
```
into Dexie table `app_users_cache`. The lock screen tries Supabase first; if offline (or Supabase errors), it falls back to a local bcrypt check against the cached hash. Same lock-out rules (5 wrong → 60 s) enforced locally. Cache is refreshed on every online unlock and invalidated when admin resets a PIN online.

Same for `verify_company_password` → company-level unlock works offline using a cached hash.

### 6. Connectivity indicator
Small chip in the top bar: **Online** / **Offline (N queued)** / **Syncing…**, click → drawer showing outbox contents, retry button, last sync time. Lives in `src/components/OfflineStatusChip.tsx`, mounted in `src/routes/app.tsx`.

### 7. Boot sequence change — `src/lib/auth-context.tsx`
- Try `ensureTechSession()` with a 3 s timeout.
- On timeout / network error → mark app as `offlineBoot=true`, skip Supabase session, let the lock screen use the local PIN cache.
- When connectivity returns later, `ensureTechSession()` retries in the background and the SyncWorker starts draining the outbox.

## What does NOT change

- Supabase schema, RLS, triggers, RPCs — untouched.
- All existing components keep calling `supabase.from(...)`. Only ~10 high-traffic call sites get migrated to the offline wrapper in Phase 1.
- Period-lock enforcement: trigger still runs server-side on sync; if a queued voucher hits a locked period, the outbox row is moved to a "Conflicts" tray for the user to fix.
- GST/e-invoice/AI features stay online-only — they show a friendly "needs internet" state when offline.
- Tauri build, backup folder picker (last week's work), and the installer plan — all untouched.

## Phasing

**Phase 1 (this PR, ~1–2 days of work):**
1. Dexie setup + cache + outbox + SyncWorker scaffolding.
2. Offline PIN cache + lock screen fallback.
3. `OfflineStatusChip` in top bar.
4. Wrap voucher create / ledger create / item create through outbox.
5. Wrap vouchers list, ledgers list, items list, day-book through read-through cache.

**Phase 2 (later, on demand):**
6. Wrap remaining read paths (reports, GST books) as users hit them offline.
7. Conflict resolution UI for period-lock / unique-key collisions.
8. Selective per-company cache eviction (avoid bloating IndexedDB if user has many companies).

## Out of scope

- Replacing Supabase. Not happening here — see chat for why (~3–6 weeks, breaks GST e-invoice, breaks multi-device).
- Full offline reports for historical periods you've never opened online (cache is populated on first online view).
- Multi-tab write coordination (we'll use a simple Web Lock around the outbox drain to avoid double-push).

## Risk / things you should know

- **First launch still needs internet** — to pull the initial cache and cache your PIN hash. After that, offline works.
- **IndexedDB quota** — Chrome/Edge typically give ~60% of free disk; in Tauri we have effectively unlimited. Fine for years of vouchers.
- **Voucher numbers** during offline runs will have an `-OFFLINE-n` suffix until they sync. If you don't want that, the alternative is "block voucher save when offline", which defeats the purpose.
- **No real "100% offline"** — anything calling GST portal / IRP / AI Gateway will still need internet. That's a legal/API constraint, not an app limitation.

After you approve, I'll start with Phase 1.
