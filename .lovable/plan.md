## Why your desktop app isn't updating

The most common reasons a GitHub Actions build "doesn't update" are all fixable in the workflow file itself. I'll harden `.github/workflows/build.yml` so every push produces a fresh, downloadable installer, and bump the app version so you can actually see the new build.

## What I'll change

### 1. Trigger builds on every push, not just tags
Right now the workflow only runs on manual dispatch or `v*` tags. If you edit code and just sync to GitHub, nothing happens. I'll add:
- `push` to `main` → builds artifacts (downloadable from Actions tab)
- `pull_request` → builds for verification
- Keep `workflow_dispatch` and `v*` tags → publishes GitHub Release

### 2. Bump version on every build so you can tell it's new
Inject the short commit SHA + run number into `tauri.conf.json` `version` before building, so the installer filename becomes e.g. `SmartAccountant_0.1.0-build.42_x64-setup.exe`. No more "did it actually rebuild?" doubt.

### 3. Fix likely Android build failures
- Pre-create `src-tauri/gen/android` guard so `tauri android init` doesn't fail on re-runs
- Set `NDK_HOME` at the job level (not per-step) so all steps see it
- Add `--split-per-abi` off / single universal APK for simpler sideloading
- Ensure `bun run build:tauri` (frontend) succeeds before Android packaging

### 4. Make failures visible
- `continue-on-error: false` (default, but explicit)
- Upload build logs as an artifact when a step fails, so you don't have to scroll the web UI
- Add a final "Summary" step that prints artifact download links to the run summary page

### 5. Cache-bust properly
Rust cache key currently keyed only on workspace; add lockfile hash so a `Cargo.lock` change forces a rebuild instead of serving stale objects.

### 6. Document the "why nothing happened" cases in `BUILDS.md`
- If Actions tab is empty → workflow permissions disabled in repo Settings → Actions → General
- If run is red → click the failing job, expand the red step
- If artifacts missing after green run → 90-day retention, re-run needed
- If installed .exe still shows old UI → uninstall old version first, or check `%LOCALAPPDATA%\com.smartaccountant.app\` for cached webview

## Files touched
- `.github/workflows/build.yml` — rewrite triggers, add version injection, fix Android env, add failure-log upload and run summary
- `BUILDS.md` — add troubleshooting section for the four "nothing updated" cases
- `src-tauri/tauri.conf.json` — bump base version `0.1.0` → `0.2.0` so a fresh install is unambiguously newer

## Not touched
No app code, no UI, no database. Pure CI/packaging.

## After you approve
You'll need to (once):
1. GitHub repo → **Settings → Actions → General** → set **Workflow permissions** to **Read and write** (required for the Release job).
2. Sync latest from Lovable, then check the **Actions** tab — a run should appear within ~30 seconds of the push.
3. Open the run → **Artifacts** section at the bottom → download `SmartAccountant-Windows` and `SmartAccountant-Android`.

If you want a public download page (not just Actions artifacts), tag a release from GitHub → Releases → **Draft new release** → tag `v0.2.0` → Publish. The workflow attaches `.exe`/`.msi`/`.apk` automatically.
