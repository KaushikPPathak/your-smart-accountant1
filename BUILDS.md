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

Bump `src-tauri/tauri.conf.json` → `"version"` before tagging a release so the installer filename and Windows Add/Remove Programs entry reflect the new version.
