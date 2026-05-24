# Option 1 — Local-Only Desktop Build (Pure Offline .exe)

Goal: ship a Windows `.exe` where **all accounting data lives only on the client's PC**. No Supabase database, no cloud login, no shared backend. Internet is used **only** for optional lookup helpers (GSTIN verification, e-invoice IRP, GSTR-2B fetch, OCR) — and only when the user clicks those specific buttons.

## What the client will experience

- Double-click `SmartAccountant.exe` → app opens straight to the **Company list** (no login, no signup, no password).
- All companies, vouchers, ledgers, items, reports → stored in a local folder on their PC (e.g. `C:\Users\<name>\AppData\Local\SmartAccountant\`).
- Backup & Restore → writes/reads `.zip` files on their own disk / pen drive / external HDD.
- **GSTIN Verify button** → works whenever PC has internet (calls AppyFlow API directly from the desktop app). Offline → button shows "Internet required".
- Same pattern for e-invoice IRP push, GSTR-2B download, bank statement OCR — optional, online-only, non-blocking.
- Two clients on two PCs = two completely separate datasets. Zero risk of data mixing.

## What changes in the code

### 1. Remove cloud auth entirely
- Delete `src/routes/login.tsx`, `signup.tsx`, `forgot-password.tsx`, `reset-password.tsx`.
- Remove auth guards from `src/routes/index.tsx` and `src/routes/app.tsx` — app boots straight to company picker.
- Delete `src/lib/tech-user.ts`, `tech-user.functions.ts`, `tech-user-credentials.ts`, `auth-context.tsx`.
- Remove `@lovable.dev/cloud-auth-js` and `@supabase/supabase-js` from `package.json`.
- Remove `src/integrations/supabase/*` and `src/integrations/lovable/*`.

### 2. Replace Supabase reads/writes with local storage
- The codebase already has `src/lib/local-mirror.ts` writing JSON snapshots to disk via Tauri/Electron bridge.
- Promote local-mirror from "mirror" → **primary source of truth**.
- Refactor data access layer: every `supabase.from('...').select/insert/update/delete` call becomes a local read/write through the desktop bridge.
- Use SQLite (via Tauri `tauri-plugin-sql`) for queryable data; JSON files for settings/snapshots.
- Migrate existing schema (tables in `src/integrations/supabase/types.ts`) into a single bundled SQLite schema file shipped inside the .exe.

### 3. Keep online helpers as opt-in
These keep working **only when internet is available**, called directly from the desktop app (no server functions, no Supabase):
- **GSTIN Verify** → direct `fetch()` to AppyFlow API using API key stored in app settings (user pastes their own key once).
- **E-invoice IRP push** → direct call to NIC IRP sandbox/production using client's credentials stored locally.
- **GSTR-2B download** → direct call to GSTN portal using client's credentials.
- **Bank statement OCR** → direct call to chosen OCR provider with client's API key.
- Each helper shows a clear "Internet required" message when offline; the rest of the app keeps working.

### 4. Desktop packaging
- Keep existing `src-tauri/` setup (already in place).
- Update `tauri.conf.json` to bundle the built frontend (`dist/`) inside the .exe — no remote URL.
- Drop the Electron folder (`electron/`) OR drop Tauri, whichever you prefer — pick one. Recommendation: **keep Tauri** (smaller .exe, faster, already configured with capabilities for file pickers and SQL).
- GitHub Actions workflow `.github/workflows/build-windows-installer.yml` builds `SmartAccountant-Setup.exe` (NSIS installer) on every release tag.

### 5. Backup & Restore (already works locally)
- `src/components/housekeeping/BackupRestoreTool.tsx` already zips local data → keep as-is.
- Add a **scheduled auto-backup** option (daily/weekly to a user-chosen folder) so clients have their own backup discipline without thinking about it.

### 6. Cleanup
- Delete `supabase/` folder, migrations, RLS policies, edge functions.
- Delete server functions (`*.functions.ts`) — replace `lookupGstin` with a plain client-side `fetch()` call.
- Delete `src/start.ts`, `src/integrations/supabase/auth-attacher.ts`, `auth-middleware.ts`, `client.server.ts`.
- Strip TanStack Start SSR → switch to plain Vite + React + TanStack Router (no server runtime needed for a desktop app).

## Effort & credits

- **Time**: ~4–6 hours of focused work (slightly more than first estimate, because I'd also strip TanStack Start SSR to keep the .exe lean).
- **Credits**: medium-large refactor — exact number depends on iteration, but it is a **one-time cost**. After this is done, every future feature / bug-fix / `.exe` rebuild stays fully local with no recurring Supabase or Cloud cost.
- **Recurring cost after this**: ₹0 per client. No Lovable Cloud subscription needed for shipped .exe.

## What you lose (be aware)

- No "open the same company from another PC" — each PC is its own world. (This is exactly what your clients want.)
- No remote support without the client sending you their backup `.zip`.
- The web preview at `your-smart-accountant.lovable.app` will be **archived / taken down** — there is no cloud version anymore. Lovable will only be used as the build pipeline that produces the `.exe`.

## Confirm before I start

1. Keep **Tauri**, drop **Electron** folder? (recommended)
2. Confirm you're OK with the Lovable web preview going away — only the `.exe` remains.
3. Should the app prompt the client to **set a backup folder on first launch** (e.g. `D:\SmartAccountantBackups\`)?

Say **go** with answers to these 3 questions and I'll start.
