# Plan — Simple PIN/Passcode Login

Keep the Phase A1 silent Supabase sign-in (no email login screen, RLS stays intact). Add a thin, classic-feeling **PIN gate** in front of the app. The admin manages staff PIN accounts from inside Settings — no public signup.

## What the user sees

1. **First launch (no admin yet)** → one-screen setup:
   - "Create admin" → name + 4–6 digit PIN (entered twice).
   - That admin is saved, then taken straight to the company picker.

2. **Every launch after that** → lock screen:
   - List of staff names (avatar initial + name).
   - Click a name → PIN keypad → unlock.
   - "Lock" button in the sidebar returns here without signing out of Supabase.

3. **Settings → Staff & PINs** (admin only):
   - Add staff (name, role: `admin` / `staff`, PIN).
   - Reset any staff PIN.
   - Remove staff.
   - Admin cannot delete the last admin.

That's the whole login surface. No email, no forgot-password email, no OAuth.

## How it works under the hood

- **Supabase auth is untouched.** `ensureTechSession()` keeps signing the shared tech user in silently on boot — RLS keeps working exactly as today.
- A new local table `app_users` stores staff:
  - `name`, `role` (`admin` | `staff`), `pin_hash` (bcrypt/argon2, never plain), `pin_salt`, `created_at`, `last_unlock_at`, `is_active`.
  - RLS: readable by the tech user (so the lock screen can list names); writes only via server functions that check the caller is an admin (verified by re-checking their PIN hash server-side).
- Active staff id is stored in `localStorage` (`ym_active_staff_id`) after a successful unlock — drives the "logged in as …" label and audit fields on vouchers.
- `sessionStorage.ym_unlocked = "1"` is the gate flag. Cleared on Lock, on tab close, and after N minutes of inactivity (configurable, default 30 min).
- Lock screen is a top-level route (`/lock`) that the root layout redirects to whenever the gate flag is missing — same pattern the company picker uses today.

## Files touched

- `supabase/migrations/*` — new `app_users` table + RLS + admin-check RPC.
- `src/lib/staff.functions.ts` (new) — `listStaff`, `verifyPin`, `createStaff`, `resetStaffPin`, `deleteStaff`, `setupFirstAdmin`. All hash PINs server-side.
- `src/lib/staff-session.ts` (new) — active staff id, unlock flag, inactivity timer, `lockWorkspace()` (replaces the one in `tech-user.ts`).
- `src/routes/lock.tsx` (new) — staff picker + PIN keypad + first-run admin setup.
- `src/routes/__root.tsx` — redirect to `/lock` when not unlocked (mirrors current company-picker guard).
- `src/components/AppSidebar.tsx` — "Lock" button + "Signed in as <name>" label.
- `src/routes/app.settings.tsx` — new "Staff & PINs" panel (admin-only).
- `src/lib/tech-user.ts` — keep silent sign-in; remove now-duplicate `lockWorkspace` helper.

## Security notes

- PINs are 4–6 digits → low entropy on their own. Mitigations:
  - Hashing uses argon2id with a per-row salt so the DB leak alone doesn't reveal PINs.
  - Server function rate-limits PIN verification (5 wrong attempts → 60-second lockout for that staff id).
  - Local-only deployment means the DB isn't reachable from the public internet.
- This is a workstation gate, not internet-grade auth. That matches the local-only direction we already committed to.

## Out of scope (for this plan)

- Per-staff Supabase users / per-staff RLS scoping. Everyone still acts as the shared tech user at the DB level. If true per-user audit is needed later, that's a separate phase.
- Biometric / Windows Hello unlock. Possible later via Tauri, not now.
- Forgot-PIN self-service. Admin resets PINs instead.

Approve and I'll start with the migration, then wire the lock screen and settings panel.
