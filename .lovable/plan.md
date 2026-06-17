## Goal

Make **this** project the active one inside the `kaushikpathak100` workspace (now on Pro Lite, 1 year), preserve the accounting data sitting inside the **old** project that already lives in that workspace, and then remove the old project.

> Important: Lovable cannot literally "overwrite" one project with another. Code is moved by **transferring** the project; backend data (companies, ledgers, vouchers) lives inside each project's own Lovable Cloud backend and has to be moved using the app's own **Backup / Restore** tool.

---

## Step 1 — Back up the old project's data (do this first, no exceptions)

1. Open the **old** project (the one already inside `kaushikpathak100`).
2. Sign in and open each company in turn.
3. Go to **Housekeeping → Backup / Restore** and click **Export backup (JSON)**.
4. Save every company's backup file somewhere safe (local drive + a second copy on USB or cloud drive). One file per company.

Do not skip this — once the old project is deleted its backend data is gone forever.

## Step 2 — Free up the project name in the target workspace

So the transferred project doesn't clash with the old one:

1. Still inside the **old** project, click the project name (top-left) → **Settings** → **Project → General**.
2. Either:
   - **Rename** it to something like `Smart Accountant (OLD - archive)`, or
   - Leave it — you'll delete it in Step 4 anyway.

## Step 3 — Transfer this project into `kaushikpathak100`

1. Come back to **this** project.
2. Click the project name (top-left) → **Settings** → **Project → General** → **Transfer workspace**.
3. Pick **kaushikpathak100** as the destination and confirm.

The code, Lovable Cloud backend, secrets and published URL all stay attached to this project — only its workspace home changes. Pro Lite billing on `kaushikpathak100` will now cover it.

## Step 4 — Restore the old data into the transferred project

1. Open the transferred project (now under `kaushikpathak100`).
2. For each company you want to bring across:
   - Create a fresh company shell (same GSTIN), **or** open the matching existing company.
   - Go to **Housekeeping → Backup / Restore → Import backup (JSON)** and pick the file you saved in Step 1.
3. Spot-check trial balance, stock summary and the last few vouchers against the old project before doing anything destructive.

## Step 5 — Delete the old project

Only after Step 4 reconciles cleanly:

1. Dashboard → right-click the **old** project card → **Delete project** (or open it → Settings → Project → Delete).
2. Confirm.

---

## Things to be aware of

- **Custom domain / published URL** stays with this project after transfer; no re-publishing needed.
- **Secrets** (e.g. `APISETU_API_KEY`) travel with the project — you don't have to re-add them.
- **Company logos** are stored in the project's Cloud storage; the JSON backup does not include them. Re-upload logos in Step 4 if needed.
- **Local PC mirror folders** on your desktop are unaffected — they belong to the machine, not the project.

---

## What I need from you

Confirm you've completed **Step 1 (JSON backups of every company in the old project)**. Once that's done, I'll walk you through Steps 2–5 in order, or do whatever in-app guidance you need next.
