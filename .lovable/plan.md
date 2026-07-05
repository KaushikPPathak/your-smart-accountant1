
# Plan — Run YourMehtaji fully offline (no internet required)

Goal: the user can open the app with the network cable pulled, view masters, create/edit vouchers, print, and see reports. When internet returns, everything syncs to the cloud automatically. No feature should throw "not synced yet" errors in normal use.

The infra is already partially there (`src/lib/offline/*`, `outbox.ts`, `voucher-executors.ts`, `snapshot.ts`, `sync-worker.ts`). This plan finishes it and makes offline the default path.

---

## 1. Offline data store (IndexedDB is the source of truth)

- Extend `src/lib/offline/db.ts` (Dexie) with full tables for: `companies`, `ledgers`, `groups`, `items`, `godowns`, `units`, `vouchers`, `voucher_items`, `voucher_postings`, `bom_templates`, `recurring`, `bank_txns`, `period_locks`, `outbox`, `sync_meta`.
- Each row carries `local_id` (uuid), optional `remote_id`, `updated_at`, `dirty` flag, `deleted` flag (soft delete), `company_id`.
- Add a `sync_meta` table storing per-table `last_pulled_at` cursor.
- Migrate current partial store; keep the existing `outbox` shape.

## 2. Read path — everything reads local first

- Introduce `src/lib/offline/repo/*.ts` (one file per entity: `ledgers.ts`, `items.ts`, `vouchers.ts`, …) exposing `list()`, `get(id)`, `create()`, `update()`, `remove()`.
- Repos always read/write Dexie. Writes also enqueue an outbox row.
- Refactor route loaders and components (`app.ledgers.tsx`, `app.items.tsx`, `app.vouchers.tsx`, voucher forms, reports) to call repos instead of Supabase directly.
- Voucher form ledger/item pickers use the local Dexie list — fixes the current "ledger not synced yet" error, because the picker and the executor share one store.

## 3. Write path — outbox + executors

- Every mutation:
  1. Write to Dexie (optimistic, immediately visible).
  2. Push an outbox job `{op, table, local_id, payload, deps:[local_ids]}`.
- Extend `voucher-executors.ts` to cover all entities (already handles vouchers). Executors translate `local_id → remote_id` using a local id-map before hitting Supabase, so a voucher created offline referencing an offline-created ledger will resolve correctly once both are pushed.
- `sync-worker.ts`: on `online` event and every 30s, drain outbox in dependency order; on success stamp `remote_id` back onto the local row.

## 4. Pull / reconcile

- New `src/lib/offline/pull.ts`: for each table, `select * where updated_at > last_pulled_at`, upsert into Dexie, advance cursor.
- Runs on: app boot (if online), after successful outbox drain, and via a "Sync now" button on `app.data-sync.tsx`.
- Conflict rule: local `dirty` rows win until they're pushed; server wins otherwise (last-write-wins by `updated_at`).

## 5. Initial hydration (first-run online snapshot)

- After login while online, `snapshot.ts` bulk-downloads all masters + last 12 months of vouchers into Dexie so the user can go offline immediately.
- Show a one-time progress screen: "Preparing offline copy…".

## 6. Auth offline

- Cache the Supabase session + a hashed PIN in Dexie (already partly in `creds-cache.ts`).
- On boot without network: if a cached session exists and PIN matches, unlock the app in offline mode; skip Supabase calls.
- Session refresh is deferred until the network is back.

## 7. Reports & printing offline

- Trial balance, day book, ledger, GSTR previews, receivables, cash/bank — all recomputed from local `voucher_postings`. No server calls.
- PDF/print uses the existing client-side renderer; no change needed beyond pointing data queries at repos.
- Features that inherently need internet (e-invoice IRN, e-way bill, GSTR filing, bank OCR upload, AI assistant) show a clear "Requires internet" state and queue the request to run when back online where it makes sense.

## 8. App shell — installable & offline-capable

- Web: enable `vite-plugin-pwa` with `generateSW`, `NetworkFirst` for HTML, `CacheFirst` for hashed assets, `injectRegister: null`. Registration wrapper (already stubbed in `pwa-registration.ts`) refuses to register in Lovable preview / iframe / dev, and supports `?sw=off` kill switch.
- Tauri desktop build already exists; it's inherently offline. Keep the current guard so `virtual:pwa-register` is not touched in Tauri builds.
- Add an "Offline" badge in the top bar driven by `online-status.ts`, plus an outbox counter ("3 changes pending sync").

## 9. UX polish

- Remove the blocking "ledger not synced" toast — replace with a non-blocking chip "will sync when online".
- `app.data-sync.tsx`: show outbox queue, last pull time, per-table row counts, "Retry failed", "Force full re-pull".
- Housekeeping page gets a "Clear local cache & re-download" button.

## 10. Rollout order

1. Extend Dexie schema + repos for ledgers & items (unblocks the current bug).
2. Refactor voucher forms + `app.ledgers` / `app.items` to repos.
3. Full outbox executor coverage + id-map.
4. Pull/reconcile + initial snapshot.
5. Reports read from local postings.
6. PWA install + offline badge + sync panel polish.
7. Offline auth (PIN) hardening.

---

## Out of scope (needs internet, will be gated)

E-invoice IRN generation, e-way bill, GSTIN portal window, GSTR upload, AI assistant chat, bank statement OCR upload, Google/OAuth sign-in flows.

## Technical notes

- Dexie v4 with compound indexes on `[company_id+updated_at]` and `[company_id+deleted]`.
- Outbox drains sequentially per company to preserve voucher numbering.
- All Supabase calls are funnelled through `src/lib/offline/net.ts` which short-circuits when offline and enqueues instead.
- No schema changes on the Supabase side are required; we only add `updated_at` triggers where missing (single migration).
