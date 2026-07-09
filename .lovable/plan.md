
# Self-healing cache + audit system

Retire the class of bug where an old Dexie row spread over new defaults leaves fields silently `false`/`null`. Five parts, ordered by impact.

## 1. Safe cache rebuild (replaces "nuke Dexie")

Nuking `ym_offline_cache_v3` would delete pending outbox rows and any local-only-mode company data, which breaks the `local-data-permanent` rule. Instead:

- Add a **"Rebuild cache from server"** button on `/app/data-health` (per company).
- It clears only `cache_*` tables for that company (not `outbox`, `dead_letter`, `meta`, `account_creds`, `companies` picker), then triggers a full snapshot pull.
- Guarded: refuses to run for a company whose outbox has pending rows, and refuses in local-only mode.
- One-click way for the user to fix a stale company without touching devtools.

## 2. Cache normalizers (self-healing on read)

New file `src/lib/offline/cache-normalizers.ts` exporting one function per cached row type:

- `normalizeCompany(row)` — `gst_registered ||= !!gstin`, `inventory_enabled ??= true`, `state_code ||= deriveFromGstin(gstin)`, `entity_status ??= "individual"`, `currency_code ??= "INR"`, `date_format ??= "dd-mm-yyyy"`, `gst_filing_frequency ??= "monthly"`.
- `normalizeLedger(row)` — `is_active ??= true`, `is_deleted ??= false`.
- `normalizeItem(row)` — same is_active/is_deleted defaults + `gst_rate ??= 0`.
- `normalizeVoucher(row)` — coerces numeric strings, defaults `is_deleted`.

Wired into `cache-read.ts` so every read returns normalized rows, and into `company-context.tsx` so `activeMembership.companies` is always coherent. Old rows heal on next read; new fields added later = one line change.

## 3. Schema-version stamp

- `SCHEMA_VERSION = 8` constant in a new `src/lib/offline/schema-version.ts`.
- On app boot, read `meta['schema_version']`. If missing or lower:
  - For online, non-local-only companies: silently trigger snapshot refetch (same code path as manual rebuild).
  - For local-only companies: log a warning + surface a soft banner on `/app/data-health` saying "Cache schema older than app — Rebuild recommended".
- Stamp bumps once refetch completes.

Any future field addition = bump version + add one line to the relevant normalizer. Users self-heal on next open.

## 4. Data-health audit panel

Extend `/app/data-health` with a new "Field integrity" section. For the active company it runs invariant checks and shows a table:

```text
Table              Issue                              Count
Ledgers            missing gst_treatment              12
Ledgers            missing group_id                    3
Items              missing hsn_code                    7
Items              gst_rate = 0 but is_taxable=true    2
Companies          missing state_code                  1
Vouchers           without postings                    0
Bill allocations   orphaned (voucher deleted)          0
```

- One "Refresh audit" button + one "Rebuild cache from server" button (reuses step 1).
- Read-only — no auto-fix. Gives you an honest number for "how many bugs are left".

## 5. Playwright smoke script

Add `scripts/smoke.mjs` (Node, calls `playwright` via `bunx`) that:

- Boots against `http://localhost:8080`.
- Iterates every sidebar link, asserts route mounts without console error.
- Opens each voucher-new route, asserts form renders.
- Opens each report route, asserts page renders (empty state OK).
- Screenshots each into `.smoke/` and writes a JSON summary.

Not wired into CI in this pass (would need `.github/workflows/build.yml` edit + secrets). Just runnable locally with `bun run smoke`. Second pass can gate builds on it.

---

## Technical notes

- Files created: `src/lib/offline/cache-normalizers.ts`, `src/lib/offline/schema-version.ts`, `src/lib/offline/cache-rebuild.ts`, `src/components/data-health/FieldIntegrityPanel.tsx`, `scripts/smoke.mjs`.
- Files edited: `src/lib/offline/cache-read.ts` (apply normalizers), `src/lib/company-context.tsx` (normalize on load), `src/components/AppSidebar.tsx` (already fixed last turn — keep), `src/routes/app.data-health.tsx` (mount FieldIntegrityPanel + rebuild button), `src/client.tsx` or wherever boot runs (call schema-version check), `package.json` (add `smoke` script).
- No Dexie version bump needed (schema unchanged). No Supabase changes.
- Respects `local-data-permanent`: rebuild is opt-in and refuses when outbox has pending work or in local-only mode.
- Respects "never compare to Tally/Busy" memory — no such references introduced.

Reply **go** to execute all five, or tell me which parts to drop / reorder.
