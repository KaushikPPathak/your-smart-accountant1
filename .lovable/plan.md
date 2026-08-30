# SECURITY DEFINER Review (read-only findings + recommendation)

## Correction to the premise

There are **not two SECURITY DEFINER functions**. There are **two linter warning *types*, each covering 41 functions** — the same 41 functions appear under both. Verified by query:

- SECURITY DEFINER functions in `public`: **41**
- Executable by `anon`: **41**
- Executable by `authenticated`: **41**
- Missing a fixed `search_path`: **0**
- Of the 41, **5 are trigger functions** (not directly callable through the API), **36 are callable RPCs**.

## Exact linter warning text

1. **Public Can Execute SECURITY DEFINER Function** (WARN, 41 issues)
   "Detects `SECURITY DEFINER` functions that are callable without signing in. Revoke `EXECUTE`, switch the function to `SECURITY INVOKER`, or move it out of your exposed API schema if it is not meant to be public."
   https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

2. **Signed-In Users Can Execute SECURITY DEFINER Function** (WARN, 41 issues)
   "Detects `SECURITY DEFINER` functions that are callable by signed-in users. Revoke `EXECUTE`, switch the function to `SECURITY INVOKER`, or move it out of your exposed API schema if signed-in users should not call it."
   https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Common properties (all 41)

- Owner: `postgres`
- `SECURITY DEFINER`: yes
- `search_path`: pinned on every one — `public`, or `public, extensions` for the bcrypt (`crypt`/`gen_salt`) functions
- Privileges: default pattern `postgres=X`, `anon=X`, `authenticated=X`, `service_role=X` (i.e. `PUBLIC`/`anon` execute was never revoked)

So the "fixed search_path" hardening the linter usually pushes is **already done everywhere**. The remaining exposure is purely the **`anon` EXECUTE grant**.

## Risk classification of the 36 callable functions

**A. Genuinely must stay anon-callable (pre-login surface)** — 5
`accounts_exist()`, `app_users_count()`, `list_login_users()`, `verify_account_login(text,text)`, `verify_app_user_pin(uuid,text)`.
These run on the lock/login screen before any session exists. They need DEFINER because `app_users` has all client SELECT revoked (password/PIN hashes must never be readable). Callers: `src/routes/lock.tsx`.
Residual concern: `list_login_users()` enumerates usernames + roles to anonymous callers; `verify_*` are unauthenticated credential oracles (mitigated by the existing 5-attempt / 60-second lockout).

**B. Anon-callable but should be authenticated-only** — 31
Everything else with an argument-based or `auth.uid()`-based authorization check inside: `save_voucher_atomic`, `next_voucher_number`, `lock_period`, `unlock_period`, `delete_import_batch`, `delete_vouchers_bulk`, `recompute_monthly_balances`, `sync_opening_balances_from_previous_fy`, `reclassify_misposted_vouchers`, `repair_orphan_vouchers_with_suspense`, `set_company_password`, `verify_company_password`, `has_company_role`, `is_company_member`, `can_write_company`, `is_period_locked`, `voucher_company_id`, `list_accounts_admin`, `update_account_admin`, `delete_account_admin`, `change_account_password`, `create_app_user`, `delete_app_user`, `reset_app_user_pin`, `_require_admin`, `_require_admin_password`, `setup_first_admin`, `setup_first_account` (x2 overloads), `signup_account` (x2 overloads).
These already fail closed for anonymous callers (`auth.uid()` is null → `Not authorized`, or an admin PIN/password is required). The anon grant is unnecessary attack surface, not an open door — **with two exceptions below**.

**C. Actual exposure worth acting on** — 3
- `signup_account(...)` — anonymous callers can create an `app_users` row with `role = 'admin'`. There is no invite/allow-list gate. Caller: `src/routes/lock.tsx` (signup screen). This is a design decision (first-run self-provisioning) but it is currently unlimited, not first-run-only.
- `setup_first_admin` / `setup_first_account` — self-guarded (`count(*) = 0`), so only exploitable on a truly empty instance; low severity but still anon-reachable.
- `_require_admin`, `_require_admin_password` — internal helpers, never called from app code; should not be in the API surface at all.

## Can anything move to SECURITY INVOKER?

No, not without breaking behaviour. Every one of the 41 either reads `app_users` (client SELECT revoked), bypasses RLS deliberately (`has_role`-style helpers used *inside* RLS policies — making them INVOKER causes infinite policy recursion), or is a trigger that must write past RLS. Verified by reading each definition.

## Recommendation

| Group | Verdict |
|---|---|
| A — 5 pre-login functions | **KEEP + HARDEN** — keep anon EXECUTE, keep DEFINER; harden by trimming `list_login_users()` output and rate-limiting the verify functions |
| B — 31 authorization-checked RPCs | **KEEP + HARDEN** — keep DEFINER; `REVOKE EXECUTE ... FROM anon, PUBLIC`, `GRANT ... TO authenticated` |
| C — `signup_account`, `_require_admin*` | **NEEDS FURTHER REVIEW** — decide whether open admin self-signup is intended; revoke all client EXECUTE on the two `_require_admin*` helpers |
| Trigger functions (5) | **KEEP** — no change; linter flags them but they are not API-reachable |

Nothing here is a confirmed data-leak vulnerability today; the linter is flagging exposure surface, and the one item that deserves a real decision is anonymous admin self-signup.

## If you approve, the change would be

A single migration that only touches grants — no function bodies, no `search_path` edits, no accounting logic:

1. `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;` for the 31 group-B functions plus the 2 `_require_admin*` helpers.
2. `GRANT EXECUTE ON FUNCTION ... TO authenticated;` (and `service_role`) for the same set.
3. Leave the 5 group-A pre-login functions and the 5 trigger functions untouched.
4. Re-run the linter to confirm the issue count drops from 41 to ~10 per warning type.

The two group-C policy questions (open admin signup, username enumeration) would be handled separately after your decision.
