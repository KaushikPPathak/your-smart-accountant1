# Plan: Test Your Mehtaji on Windows

Your Electron desktop app is a **thin wrapper** that loads your published Lovable site (`https://biz-account-hero.lovable.app`) inside a native window. The Windows installer build pipeline already exists in `.github/workflows/build-windows-installer.yml` and `electron/icon.ico` is present. Two fixes needed before you build:

## Issues found

1. **Wrong URL hardcoded in `electron/main.cjs`**
   Currently points to `https://the-ledger-buddy.lovable.app` (an old project). Your published site is `https://biz-account-hero.lovable.app`. The desktop app would open the wrong app.

2. **No portable build output**
   Workflow only produces an installer `.exe`. Adding a portable zip lets you test without installing (just unzip and double-click).

## Changes I'll make

### 1. `electron/main.cjs`
Change `APP_URL` from `the-ledger-buddy.lovable.app` → `biz-account-hero.lovable.app`.

### 2. `.github/workflows/build-windows-installer.yml`
Add a step that zips `electron/release/Your Mehtaji-win32-x64/` into `YourMehtaji-Portable-1.0.0.zip` and uploads it as a second artifact alongside the installer.

That's it — no other code changes needed. The desktop app already has:
- Per-company file saving to `Documents\YourMehtaji\Exports\<Company>\...`
- Auto-open in default viewer with "Show in folder" toast
- Menu bar with Reload, Open Exports Folder, Quit, etc.

## How to test on Windows after I push these changes

### Step 1 — Connect to GitHub (if not already)
In Lovable editor: **Connectors** (left sidebar) → **GitHub** → **Connect project** → authorize → **Create Repository**. Lovable auto-syncs all changes to that repo.

### Step 2 — Run the Windows build
1. Go to your repo on **github.com** → **Actions** tab
2. Click **"Build Windows Installer"** in the left list
3. Click **"Run workflow"** button (top-right) → **Run workflow**
4. Wait ~5–8 minutes for the green checkmark

### Step 3 — Download the build
On the completed run page, scroll to **Artifacts**:
- **`YourMehtaji-Setup`** → installer `.exe` (Option A)
- **`YourMehtaji-Portable`** → portable zip (Option B)

Or grab from the auto-created **Release** in the repo's Releases section.

### Step 4 — Run on Windows

**Option A (installer):**
- Double-click `YourMehtaji-Setup-1.0.0.exe`
- Windows SmartScreen warning → **More info** → **Run anyway** (normal for unsigned apps)
- Install completes → launch from Desktop shortcut or Start Menu → "Your Mehtaji"

**Option B (portable, no install):**
- Unzip `YourMehtaji-Portable-1.0.0.zip` anywhere
- Open the folder → double-click `Your Mehtaji.exe`
- App opens immediately

### Step 5 — Verify it works
- Login with your existing account (data is shared with the web version since it loads the same site)
- Try **File → Open Exports Folder** (top menu)
- Export a report → confirm it saves to `Documents\YourMehtaji\Exports\<CompanyName>\` and auto-opens

## Notes & limitations

- **Unsigned installer** — Windows shows "Unknown publisher" warning. Code signing requires a paid certificate (~$100/yr). Safe to ignore for personal testing.
- **Internet required** — the desktop app loads your published Lovable site, so it needs an internet connection. (Truly offline mode would require a separate larger refactor.)
- **Updates are automatic** — when you publish updates in Lovable, the desktop app picks them up on next launch (no need to reinstall).
- **Data lives in the cloud** (Lovable Cloud / Supabase), not on the Windows PC. Exported files (PDFs/Excel/CSV) are saved locally to `Documents\YourMehtaji\Exports\`.

## After you approve

I will:
1. Patch `electron/main.cjs` with the correct URL
2. Update the workflow to also produce the portable zip
3. Confirm everything is committed so the workflow is ready to run on GitHub
