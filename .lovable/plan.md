## Goal

Make the first-launch experience local-first. No sign-in wall. The user lands on a simple choice screen, can create a company immediately, and everything is stored on disk (IndexedDB + Tauri SQLite). An account is optional and only needed for cloud backup / multi-device / recovery.

## New first-launch screen (`/welcome`)

A new route `src/routes/welcome.tsx` with four options:

1. **Create New Company** (primary, large button)
2. **Open Existing Company** — only shown if local companies already exist on this device
3. **Restore Backup** — opens existing `RestoreFromFileDialog`
4. **Sign In** — small secondary link at the bottom, routes to `/lock`

No email/password required for options 1–3.

## Silent local device profile

New helper `src/lib/local-device-profile.ts`:

- `ensureLocalDeviceProfile()` — idempotent. If no staff session and no account exists locally, create a hidden profile:
  - `id`: stable device UUID stored in localStorage (`ym_local_device_id`)
  - `name`: "This device"
  - `role`: `admin`
  - `username`: `local-device`
  - No password, no cloud row.
- Calls `markUnlocked(...)` so `LockGate` in `__root.tsx` stops redirecting to `/lock`.
- Sets `isLocalOnlyMode(true)` (already the default).
- Persists a flag `ym_local_profile_ready = "1"` so we know onboarding is done.

No user-visible term "Guest". UI copy just says "Local mode" / "Stored on this computer".

## Routing changes

`src/routes/__root.tsx` — `LockGate`:
- Add `/welcome` to `LOCK_EXEMPT_PATHS`.
- On boot, if `!isUnlocked()`:
  - If `ym_local_profile_ready === "1"` → silently re-`ensureLocalDeviceProfile()` and continue (no lock screen).
  - Else if any cloud accounts exist locally (`listCachedAccounts()` returns rows) → go to `/lock` (existing behavior for returning cloud users).
  - Else → go to `/welcome`.

`src/routes/index.tsx`:
- If no companies exist AND no local profile yet → redirect to `/welcome`.
- Otherwise unchanged (still the company picker).

## "Create New Company" flow

Button on `/welcome`:
1. `await ensureLocalDeviceProfile()`
2. `navigate({ to: "/app/companies", search: { new: 1 } })`

`app.companies.tsx` new-company dialog already works locally via IndexedDB — no changes needed to the create logic itself.

After the very first company is created, show a one-time non-intrusive toast + a persistent dismissible banner (`BackupNudgeBanner` already exists — extend it to also show when `ym_local_profile_ready === "1"` and no account is connected). Copy:

> Your books are stored only on this computer. Create a backup or connect an account to keep them safe.

Buttons: **Create backup** (opens existing backup dialog) · **Connect account** (routes to `/app/settings#connect-account`) · **Dismiss**.

## Settings — "Connect Account" section

Add a new card in `src/routes/app.settings.tsx` (id `connect-account`):

- **State A — no account linked:**
  - Explains benefits: cloud backup, multi-device sync, password recovery.
  - Buttons: **Sign in** and **Create account**, both route to `/lock` with a `?linkLocal=1` query param.
- **State B — account linked:**
  - Shows the linked username + role.
  - **Sign out** button (keeps local data intact).

## Local → account migration

New helper `src/lib/link-local-to-account.ts`:

- Called from `/lock` after successful login/signup when `linkLocal=1` is present.
- Reads all `offlineDb.companies` + `cache_companies` rows whose `account_id === "local-user"` or is the local device id, and:
  - Updates `account_id` to the newly-authenticated `user_id` (IndexedDB only — local-only mode remains on).
  - Enqueues a one-shot outbox item per company + its cache rows so that if the user later toggles cloud sync ON, the data will upload. When local-only mode stays ON (default), the outbox stays paused and nothing leaves the device.
- Sets `ym_local_profile_ready` to `"linked"`.
- Zero data loss — all local rows are preserved; only the owning-account pointer changes.

## Compatibility notes

- Authentication code paths (`/lock`, `staff-session`, `creds-cache`) are untouched — they still work for users who choose Sign In or Create Account.
- Licensing (`src/lib/license/*`) reads machine id, not user id → unaffected.
- Future sync: local-only mode remains the master switch. Nothing in this change turns cloud sync on automatically. The account, when linked, is purely an identity + optional backup destination.
- No changes to Supabase schema, RLS, or migrations.

## Files touched

Create:
- `src/routes/welcome.tsx`
- `src/lib/local-device-profile.ts`
- `src/lib/link-local-to-account.ts`

Edit:
- `src/routes/__root.tsx` — LockGate branching
- `src/routes/index.tsx` — redirect to `/welcome` when empty
- `src/routes/lock.tsx` — read `linkLocal` search param, call `linkLocalToAccount()` after auth success
- `src/routes/app.settings.tsx` — add Connect Account card
- `src/components/BackupNudgeBanner.tsx` — extend trigger to also fire for local-profile-only users

## Out of scope

- Actual cloud sync toggle UI (deferred; local-only stays on).
- Per-company migration checklist (auto-attach chosen previously).
- Aggressive backup nudge modal (banner-only chosen previously).

Confirm and I will implement.
