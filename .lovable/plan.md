## Verify today's local-first + user-owned cloud backup work

Run a focused verification pass across the four things shipped today. No code changes — just checks. If anything fails, I'll come back with a fix plan.

### 1. Static / build sanity
- Typecheck the new/edited files:
  - `src/lib/local-only-mode.ts`
  - `src/lib/cloud-migration.ts`
  - `src/lib/user-cloud-backup.ts`
  - `src/lib/cloud-providers.ts`
  - `src/components/settings/DataLocationCard.tsx`
  - `src/components/settings/CloudBackupCard.tsx`
  - `src/routes/oauth-callback.tsx`
  - `src/routes/app.settings.tsx`
  - `src/lib/auth-context.tsx`
  - `src/lib/offline/{outbox,snapshot,sync-worker}.ts`
- Confirm `routeTree.gen.ts` picked up `/oauth-callback`.
- Grep for stale imports / dead references to removed sync paths.

### 2. Local-only guard actually short-circuits
- Read `outbox.ts`, `snapshot.ts`, `sync-worker.ts` and confirm every network-touching entry point checks `isLocalOnlyMode()` early and returns.
- Confirm `cloud-migration.ts` intentionally bypasses that guard (calls `pullCompanySnapshot` directly, as noted in code comments) so upgraders still get their data down.
- Confirm no other module still calls the outbox drain or snapshot push loop.

### 3. Settings page renders both new cards
- Drive Playwright against `http://localhost:8080/app/settings` with the injected Supabase session:
  - Screenshot the page.
  - Assert `DataLocationCard` and `CloudBackupCard` are both visible.
  - Assert the three provider buttons (Google Drive / OneDrive / Dropbox) render, and — since no `VITE_*_CLIENT_ID` is set — the "client ID missing" warning shows instead of a live OAuth popup.
  - Click "Export .laccbak (all companies)" and confirm a download is triggered (intercept via Playwright's download event) and `getLastUserCloudBackup()` timestamp updates in `localStorage`.

### 4. Cloud migration flow (dry read-only check)
- Inspect `runOneTimeCloudMigrationDown()` for:
  - Idempotency flag (`cloud_migration_v1_done`) set only on zero-error runs.
  - Correct order: pull all → verify no errors → then delete memberships → then delete orphan companies.
  - No accidental deletion when `pullCompanySnapshot` returns partial errors.
- Do NOT execute it against the live account — just static review. If you want a live dry-run against your own account, say so and I'll add a "simulate" toggle in the next step.

### 5. Report
I'll come back with: ✅/❌ per section, screenshots of the Settings page, and a short list of any regressions or gaps found. No files will be modified during verification.

Approve and I'll run it.
