# Plan: SECURITY DEFINER Grant Hardening (grants only)

## Scope

One migration touching **privileges only** on the 26 authorization-checked SECURITY DEFINER RPCs (Group B + the two internal admin helpers). Verified exact signatures; no overload ambiguity.

- REVOKE EXECUTE from `PUBLIC` and `anon`
- GRANT EXECUTE to `authenticated` (service_role EXECUTE preserved via explicit GRANT)
- No changes to function definitions, bodies, DEFINER status, search_path, RLS, accounting logic, or app code

Explicitly untouched: the 5 pre-login functions (`accounts_exist`, `app_users_count`, `list_login_users`, `verify_account_login`, `verify_app_user_pin`), `signup_account` (both overloads), `setup_first_admin`, `setup_first_account` (both overloads), and all 5 trigger functions.

Note: the earlier "31" estimate came from counting overloaded `signup_account`/`setup_first_account` variants in the group; after excluding them per your instruction, the exact set is **26 functions**.

## Functions affected (26, exact signatures)

```text
_require_admin(uuid, text)
_require_admin_password(uuid, text)
can_write_company(uuid, uuid)
change_account_password(uuid, text, text)
create_app_user(uuid, text, text, app_user_role, text)
delete_account_admin(uuid, text, uuid)
delete_app_user(uuid, text, uuid)
delete_import_batch(uuid)
delete_vouchers_bulk(uuid, voucher_type, date, date)
has_company_role(uuid, uuid, company_role)
is_company_member(uuid, uuid)
is_period_locked(uuid, date)
list_accounts_admin(uuid, text)
lock_period(uuid, text, text, date, date, text, text)
next_voucher_number(uuid, voucher_type)
reclassify_misposted_vouchers(uuid)
recompute_monthly_balances(uuid)
repair_orphan_vouchers_with_suspense(uuid)
reset_app_user_pin(uuid, text, uuid, text)
save_voucher_atomic(jsonb, jsonb, jsonb)
set_company_password(uuid, text)
sync_opening_balances_from_previous_fy(uuid, date)
unlock_period(uuid, text, text, text)
update_account_admin(uuid, text, uuid, text, app_user_role, boolean, boolean, text)
verify_company_password(uuid, text)
voucher_company_id(uuid)
```

## SQL shape (per function)

```sql
REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated, service_role;
```

## Verification after the migration

1. Query `has_function_privilege` for all 26: anon = false, authenticated = true, service_role = true.
2. Re-run the Supabase linter and report remaining warning counts (expected drop from 41 to ~10 anon-flagged and ~10 authenticated-flagged: 5 pre-login + signup/setup + 5 triggers).
3. Run the regression suite (Vitest) and confirm the build is clean.

## Out of scope (unchanged by this work)

signup_account open-signup, username enumeration, dependency vulnerabilities, and all other findings.
