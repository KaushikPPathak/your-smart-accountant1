## Goal

Replace the email/password sign-up + sign-in flow with a **company-first start screen**. Users open the app and see a list of companies; clicking one either lets them in immediately, or prompts for a per-company password if the admin set one. No more user signups, no more landing page CTA to "Create account".

The Supabase backend still requires an authenticated user (RLS depends on `auth.uid()`), so under the hood the app will sign into a single shared technical user automatically. This is invisible to you.

## What changes for you (UX)

```text
Before:                              After:
  Landing page                         Start screen = company picker
   ├─ Sign up                          ├─ [ Acme Traders ]   (no lock → opens directly)
   └─ Sign in                          ├─ [ Sharma Exports ] (🔒 → asks password)
       └─ workspace                    └─ [ + New company ]
                                         → workspace
```

- No signup page. No "Sign in" button on landing.
- Start screen lists every company in the database.
- Each company card shows a 🔒 if a password is set; click → password prompt.
- Settings → "Company access" lets the admin **set / change / remove** a password for that company. Optional by default.
- Top-bar "Sign out" becomes "Lock" (returns to the company picker).

## Cleanup of existing 2 accounts

- I will **merge** the two existing accounts: pick one as the keeper, reassign all `companies`, `vouchers`, `ledgers`, `items`, `bank_statements`, `recurring_invoices`, `payment_reminders`, etc. from the other account onto the keeper, then delete the second auth user.
- After merging, that single keeper user becomes the silent technical user the app auto-signs-into.
- **You'll need to tell me which email to keep** when I switch to build mode. I'll also ask you to set the technical user's password (stored as a project secret, never shown in the UI).

## Technical details

1. **DB migration**
   - Add column `companies.access_password_hash text NULL` and `companies.access_password_set_at timestamptz NULL`.
   - Storing a bcrypt hash (via `pgcrypto`'s `crypt()` + `gen_salt('bf')`). Plain passwords never stored.
   - Add two SECURITY DEFINER RPCs:
     - `set_company_password(_company_id uuid, _new text NULL)` — admin-only, hashes & stores or clears.
     - `verify_company_password(_company_id uuid, _attempt text) returns boolean` — checks hash.
   - Add a public-readable view `companies_public(id, name, has_password)` so the start screen can list companies without exposing other fields before "unlock". Backed by a permissive SELECT policy returning only those 3 columns.

2. **Data merge migration** (run after you confirm the keeper email)
   - `UPDATE` `created_by`, `imported_by`, `sent_by`, `created_by` columns and `company_members.user_id` from old uid → keeper uid.
   - `DELETE FROM auth.users WHERE id = old_uid` (cascades).

3. **Frontend**
   - Add `src/lib/auto-signin.ts`: on app boot, if no Supabase session, calls `signInWithPassword` using the keeper email + a password kept in `VITE_TECH_USER_EMAIL` / a server-fn-fetched secret. (Email is fine in client; password is fetched via a `createServerFn` so it never ships in the bundle.)
   - Replace `src/routes/index.tsx` landing with a **CompanyPicker** screen (cards for each company, lock icon if `has_password`, "+ New company" button).
   - On click: if no password → set active company → `navigate('/app')`. If password → modal → call `verify_company_password` RPC → on success, store `unlocked_company_<id>=true` in `sessionStorage` and proceed.
   - `src/routes/app.tsx`: drop the email-based auth gate. Instead require an `unlocked` session-storage flag for the active company; if absent, bounce back to `/`.
   - Replace `Sign out` dropdown item with `Lock workspace` (clears session-storage unlocks, keeps the technical Supabase session).
   - **Delete** `src/routes/signup.tsx` and `src/routes/login.tsx`. Remove the user-email chip in the header (replaced by company name only).
   - Settings page: add a "Company access password" card with `Set password` / `Change password` / `Remove password` buttons (admin-only).

4. **What stays the same**
   - All existing data, RLS, vouchers, GST features.
   - Backup/Restore tool.
   - Multi-company switching from the top bar (no re-prompt within a session unless you click Lock).

## Trade-offs you should know about

- **Anyone who reaches the app URL sees the company list** (names only). If that's a problem, tell me and I'll add a single optional "app password" gate before the picker.
- Per-company passwords protect against casual access, **not** a determined attacker who has both your URL and your database — RLS will treat them as the technical user once auto-signed-in. This is the correct model for a single-operator desktop-style app, which is what you described, but it's not multi-tenant security.
- The Windows desktop build (`electron/`) keeps working unchanged; the auto sign-in happens silently on launch.

## Open items I need from you when we switch to build mode

1. Which of the two existing emails to **keep** (the other is deleted after data merge).
2. Confirm: OK to keep one hidden technical Supabase user (required, otherwise nothing works).
3. Should the picker also have an optional **single app-level password** in front of the list? (default: no.)
