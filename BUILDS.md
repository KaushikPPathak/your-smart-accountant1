# Downloadable Builds — Windows & Android

Both installers are produced by GitHub Actions from this repo. Nothing to install on your machine.

## One-time setup (30 seconds)

1. Push this project to GitHub (or connect it via the Lovable → GitHub integration).
2. In your repo, go to **Settings → Actions → General → Workflow permissions** and enable **Read and write permissions** (needed so tagged builds can publish a Release).

## Get a Windows `.exe` / `.msi` and Android `.apk`

### Option A — Manual build (any time)

1. Go to your repo → **Actions** tab → **Build Desktop & Mobile** workflow.
2. Click **Run workflow** → **Run workflow**.
3. Wait ~10–15 minutes. Two artifacts appear at the bottom of the run:
   - **SmartAccountant-Windows** → contains `.msi` and NSIS `.exe` installers
   - **SmartAccountant-Android** → contains the `.apk` (install directly on any Android phone)

Download the zip, unzip, and share/install.

### Option B — Tagged release (public download page)

Create a version tag and the same workflow will additionally publish a GitHub **Release** with all files attached to a public download page:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Users can then download from `https://github.com/<you>/<repo>/releases`.

## What's inside

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (x64) | `SmartAccountant_0.1.0_x64_en-US.msi` or `..._x64-setup.exe` | Installs per-user, no admin needed |
| Android 7+ (arm64/armv7/x86_64) | `app-universal-release-unsigned.apk` | Sideload: enable "Install unknown apps" for your browser/file manager |

The Android APK is **unsigned** (fine for personal sideloading and internal testing). For Play Store distribution you'll need to add a keystore and sign it — say the word and I'll wire that up.

## Version number

Every CI build now auto-stamps a unique version like `0.2.0-build.42+abc1234` into the installer filename, so you can always tell which run a downloaded `.exe`/`.apk` came from. Bump `src-tauri/tauri.conf.json` → `"version"` when you want a new **base** version for a public tag.

---

## "My desktop app isn't updating" — troubleshooting

| What you see | Why | Fix |
|---|---|---|
| **Actions tab is empty**, no runs appear after you push | Actions disabled for the repo, or workflow permissions off | Repo → **Settings → Actions → General** → enable **Allow all actions** and set **Workflow permissions** to **Read and write** |
| Workflow runs but ends with a **red X** | A build step failed (usually Android NDK or Rust compile) | Click the failed job → expand the red step. A `windows-build-log` / `android-build-log` artifact is auto-uploaded on failure — download it for the full log |
| **Green check but no new artifacts** | Artifacts expired (90-day GitHub retention) | Re-run the workflow: Actions → the run → **Re-run all jobs** |
| Installed `.exe` **still shows the old UI** after re-install | Old install cached in `%LOCALAPPDATA%` | Uninstall from Add/Remove Programs, then delete `%LOCALAPPDATA%\com.smartaccountant.app\` and re-install |
| Tagged `v1.0.0` but **no Release page** appeared | Workflow permissions weren't "Read and write" when the tag was pushed | Fix the permission, delete the tag, re-push it: `git push --delete origin v1.0.0 && git tag -d v1.0.0 && git tag v1.0.0 && git push origin v1.0.0` |
| Android APK installs but **crashes on launch** | Unsigned APK + strict device policy | Enable "Install unknown apps" for your file manager and allow the app in device security settings |

If a build fails, the run's **Summary** page now lists each job's result and points you at the artifacts section — you no longer have to hunt for the download link.

