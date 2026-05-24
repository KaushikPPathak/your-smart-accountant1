## Plan: Harden SaaS model (per-user data isolation)

You picked **option 2 — SaaS**: one shared cloud, every client signs up, RLS guarantees each client only sees their own companies and data. Here's what to lock down before selling.

### 1. Force authentication on the web

Today the published site lets anyone open `/app/companies` without signing in (that's why you saw "no companies" — you were effectively an anonymous visitor, and RLS correctly returned nothing).

- Add a real `/login` + `/signup` route (email + password, plus Google OAuth).
- Wrap `/app/*` in a `_authenticated` layout that redirects unauthenticated users to `/login`.
- Remove any "tech user" / silent auto-login path on the published site.
- Keep "auto-confirm email" **off** so users must verify their email.

### 2. Audit RLS on every table

Verify each tenant table (companies, ledgers, items, vouchers, voucher_items, members, etc.) has RLS enabled with policies of the shape:

```
USING (company_id IN (SELECT company_id FROM members WHERE user_id = auth.uid()))
```

Anything missing a policy = data leak. I'll run the linter and fix gaps.

### 3. Membership model

- When a user signs up, they get their own user_id but **no companies**.
- "New Company" inserts a `companies` row owned by them + a `members` row (role = owner).
- Invites: owner can add other emails as members of their company (optional, for multi-user firms).

### 4. Desktop app (.exe) changes

- Same login screen — the .exe just loads the hosted site, so the same auth applies automatically.
- First launch on a new PC → user signs in → sees only their own companies.
- Existing local JSON mirrors stay on the user's disk; they can use Backup & Restore to push them into their own cloud account.

### 5. Your personal data

- Your Windows mirror files stay on your PC — never uploaded automatically.
- Before going live, decide:
  - **Keep your data**: sign up with your real email, restore your mirrors into your own account. Other clients won't see it (RLS).
  - **Start clean**: don't restore; ship empty. Your local files remain untouched as a personal backup.

### 6. Pre-launch checklist

- [ ] Auth UI live (signup, login, logout, password reset, Google)
- [ ] `_authenticated` guard on all `/app/*` routes
- [ ] RLS linter shows zero warnings
- [ ] Manual test: create 2 accounts in 2 browsers, confirm neither sees the other's companies
- [ ] Remove any dev-only "tech user" bypass from production build
- [ ] Privacy policy + terms page (basic, required by Google OAuth consent screen)

### Technical notes

- Auth: Supabase Auth via Lovable Cloud (email/password + Google provider, both via `supabase--configure_social_auth`).
- Route guard: TanStack Start `_authenticated.tsx` layout with `beforeLoad` redirecting unauthenticated sessions to `/login`.
- RLS helper: `has_company_access(_company_id uuid)` SECURITY DEFINER function reading `members` to avoid recursive policy issues.
- No schema changes expected beyond confirming/repairing RLS policies.

---

Want me to proceed with **all six steps** when you switch to build mode, or start with just **steps 1 + 2** (auth + RLS audit) and we test before doing the rest?
