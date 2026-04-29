# Remix Safety Checklist

When you remix this project (or move it to a new account), the **code** is
copied but the **Lovable Cloud backend is brand new and empty**. That includes:

- No tables, functions, triggers, RLS policies, storage files
- No secrets (API keys must be re-added)
- No auth users
- No company / ledger / voucher data

The 27 April breakage happened because triggers were missing on the new backend
— functions existed but nothing fired them. Use this checklist every time.

---

## Step 1 — Re-add secrets (required)

Open Cloud → Edge Functions → Secrets and re-add:

- `APPYFLOW_GST_API_KEY` — your AppyFlow GST verification key
- (Lovable / Supabase keys are auto-managed)

## Step 2 — Verify triggers exist (CRITICAL)

Ask Lovable in chat: **"Run the trigger audit query."**

Expected: 12 triggers across `auth.users`, `public.companies`,
`public.profiles`, `public.ledgers`, `public.items`, `public.vouchers`,
`public.company_settings`, `public.recurring_invoices`,
`public.einvoice_details`, `public.gst_api_credentials`.

If fewer, ask Lovable to **"re-run the trigger repair migration"**.

## Step 3 — Smoke test

1. Sign up a throwaway user → confirm a `profiles` row appears.
2. Create a throwaway company → confirm a `company_members` admin row and a
   `company_settings` row appear.
3. Delete the throwaway company.

If any of these fail, **stop** and ask Lovable to investigate before importing
real data.

## Step 4 — Re-upload company logos

Storage bucket contents (logos in `company-logos`) are NOT copied on remix.
Re-upload from the old account.

## Step 5 — Restore accounting data

Use the in-app **Housekeeping → Backup / Restore** tool with the JSON backup
exported from the old account. This step belongs LAST — never restore data
into a backend that hasn't passed Step 3.

---

## Backup discipline (prevents the next 27 April)

- Export a backup **weekly** and **before any structural change**.
- Keep at least 2 copies (local + USB / cloud drive).
- Treat the working account as production; test risky changes on a remix first.
