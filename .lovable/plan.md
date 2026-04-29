# Goal

Make sure this remixed project is a **fully working copy** of your old account's app — code AND Lovable Cloud backend — and prevent another "continuous data error" like 27 April.

Important up front: a remix only copies **code**. The Cloud backend (database tables, RLS, functions, storage, secrets) is **always fresh and empty** on a remix. There is no "import the old Supabase" button. What we *can* do is make sure every migration in the code has actually been applied to this new backend, and that secrets/buckets are in place. That is what failed last time.

This plan does NOT touch your accounting data (companies, ledgers, vouchers). You said you'll restore those yourself via the in-app Backup/Restore tool — that's correct.

---

## Step 1 — Audit this remix's backend vs the code

I'll check, on the new Cloud project (`lrizbsazbgpzyehktwvk`):

1. **Migrations applied** — list every `.sql` file in `supabase/migrations/` and confirm every table, enum, function, trigger, and RLS policy it defines actually exists in the live database.
2. **Functions present** — confirm `has_company_role`, `is_company_member`, `can_write_company`, `next_voucher_number`, `handle_new_company`, `handle_new_user`, `handle_new_company_settings`, `update_updated_at_column`, `voucher_company_id` all exist (the secrets panel says they do — good).
3. **Triggers present** — the secrets panel says "no triggers", which is **suspicious**. `handle_new_user` and `handle_new_company` need to be wired as triggers on `auth.users` and `public.companies` or new signups / new companies will silently fail (this is a very likely cause of your 27 April errors).
4. **Storage bucket** — `company-logos` exists and is public. ✅ confirmed.
5. **Secrets** — `APPYFLOW_GST_API_KEY`, `LOVABLE_API_KEY`, Supabase keys all present. ✅ confirmed.
6. **RLS** — run the Supabase linter to catch tables without RLS or weak policies.

## Step 2 — Repair anything missing

Most likely findings and fixes:

- **Missing triggers** → write a migration that creates:
  - `on_auth_user_created` AFTER INSERT ON `auth.users` → `handle_new_user()`
  - `on_company_created` AFTER INSERT ON `public.companies` → `handle_new_company()` and `handle_new_company_settings()`
  - `updated_at` triggers on tables that have an `updated_at` column
- **Missing tables / columns** from later migrations that didn't replay → re-run them as a fresh migration.
- **Missing RLS policies** → add them.

Each fix is a new SQL migration file (safe, idempotent — uses `IF NOT EXISTS` / `CREATE OR REPLACE`).

## Step 3 — Smoke test the critical paths

After repairs, I'll verify by reading the DB:

- Can a new auth user → row in `profiles`? (tests `handle_new_user` trigger)
- Can a new company → row in `company_members` + `company_settings`? (tests `handle_new_company` triggers)
- Does `next_voucher_number` increment correctly?
- Are RLS policies blocking cross-company reads?

I won't insert test data into your real account — I'll only read schema and existing rows.

## Step 4 — Give you a "remix safety checklist"

So next time you remix or move accounts, you have a 1-page checklist that prevents the 27 April situation:

1. Immediately after remix: open this app, ask Lovable "audit backend vs migrations".
2. Re-add all secrets (list provided).
3. Confirm triggers exist (list provided).
4. Run a smoke test (create throwaway company, delete it).
5. *Then* restore your accounting JSON backup.

I'll save this checklist into the project as `docs/REMIX_CHECKLIST.md` so it travels with the code.

---

## Technical details (for the record)

- **Read-only inspection** uses `supabase--read_query` against `information_schema` and `pg_catalog` to enumerate tables, columns, functions, triggers, and policies.
- **Repairs** are written as new files in `supabase/migrations/` with timestamped names and approved via the migration tool. All DDL uses `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` so re-running is safe.
- **No destructive operations.** No `DROP TABLE`, no `TRUNCATE`, no data deletion.
- **No edits to** `src/integrations/supabase/client.ts`, `types.ts`, or `.env` (all auto-generated).
- **Storage bucket contents** (existing logos in your old account) are NOT migrated — buckets contents don't move on remix and there's no API call I can make from one project's storage to another's. If you need old logos, download them from the old account's Cloud → Storage and re-upload here.

---

## What this plan does NOT do

- Does NOT copy data (companies, ledgers, vouchers) from old account → use the in-app Backup/Restore for that.
- Does NOT copy storage bucket files → re-upload manually.
- Does NOT touch your old (working) account in any way.

---

## Approve to proceed

If you approve, I'll start with Step 1 (audit) and report findings before making any schema changes. You'll see the exact list of "missing X" before I write any migration.
