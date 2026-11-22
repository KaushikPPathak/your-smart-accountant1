# ADR 0001: Storage layers

Status: accepted (documents the current design)

## Context

Smart Accountant runs as a desktop app (Tauri) and in a browser, and must keep working offline. Books are money, so a reader must never see a number that disagrees with the saved vouchers.

## Decision

Three layers, each with one job:

1. **Desktop SQLite (`smart_accountant.db`)**, in the app data folder, through `tauri-plugin-sql` (`src/utils/nativeDb.ts`). It is the local system of record on desktop. Startup runs `PRAGMA integrity_check` and records the result (`src/lib/sqlite-integrity.ts`); a failure shows a warning banner and changes nothing. One copy per day is taken with `VACUUM INTO` into `db-snapshots/` (`src/lib/sqlite-snapshot.ts`). Copies are never deleted automatically.
2. **Browser cache (IndexedDB via Dexie, `src/lib/offline/db.ts`)**. It holds the offline cache (ledgers, vouchers, items, metadata) that the reports and forms read when the cloud is unreachable. It is a cache of server data plus queued offline writes, not a second book.
3. **Cloud (Supabase, `src/integrations/supabase`)**. It is the sync target when online. Its generated types define the shape of the returns and voucher data.

Money is stored and computed as integer paise everywhere. Rupee amounts are produced only at presentation or in the return builders' output.

## Consequences

- A change to a voucher must reach the local layer first. Reports read the local layer, so a sync gap shows up as a report gap. The GSTR-9 breakdown reads only the local books cache, so it must be fully synced before filing use.
- Duplicate protection on import is enforced in the import code, not by a database constraint. No unique index exists on voucher number and date.
- Backup is manual export plus the daily SQLite copy. Copies accumulate on disk; there is no automatic cleanup.
- Schema changes need a migration for each layer (`src/lib/app-data-migrations.ts` for SQLite, a Dexie version bump for IndexedDB, and Supabase migrations for cloud).
