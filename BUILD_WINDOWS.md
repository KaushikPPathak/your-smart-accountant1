# Build Smart Accountant for Windows (no GitHub needed)

Build the `.exe` / `.msi` installer directly on your own Windows PC. After install, the app runs offline with its own SQLite engine — no Node, no GitHub, no build step.

---

## 1. One-time setup on the Windows PC

Install these once (in this order):

1. **Node.js 20 LTS** — https://nodejs.org/en/download (pick "Windows Installer .msi", 64-bit). Accept defaults.
2. **Rust toolchain** — https://www.rust-lang.org/tools/install → download `rustup-init.exe` → run → press **1** (default install).
3. **Visual Studio Build Tools 2022** — https://visualstudio.microsoft.com/visual-cpp-build-tools/ → run installer → in the workloads screen tick **"Desktop development with C++"** → Install. (~6 GB.)
4. **WebView2 Runtime** — already shipped with Windows 10/11. If on older Windows, get the Evergreen Standalone Installer from https://developer.microsoft.com/microsoft-edge/webview2/.
5. **Git** (optional, only if you want to clone instead of downloading a zip) — https://git-scm.com/download/win.

Close and reopen PowerShell after installing so `node`, `cargo`, `rustc` are on PATH.

Verify:
```powershell
node -v        # v20.x
npm -v
rustc --version
cargo --version
```

---

## 2. Get the source code

**Option A — clone from GitHub:**
```powershell
git clone <your-github-repo-url> smart-accountant
cd smart-accountant
```

**Option B — download zip:** GitHub → green **Code** button → **Download ZIP** → unzip → open the folder in PowerShell.

---

## 3. Build the installer

From inside the project folder:

```powershell
npm ci
npm run tauri build
```

First build takes 10–25 minutes (Rust compiles everything). Subsequent builds take 1–3 minutes.

---

## 4. Find your installer

When the build finishes, the installers are here:

```
src-tauri\target\release\bundle\nsis\SmartAccountant_0.2.0_x64-setup.exe
```

Double-click the **NSIS (.exe)** installer. The project intentionally produces only one Windows installer type so an old MSI and a new EXE cannot remain installed side by side and open different app versions.

After install, launch **Smart Accountant** from the Start menu. It will open in its own window and connect to the same Lovable Cloud backend as the web app.

---

## 5. Updating later

When you pull new code (or download a fresh zip):

```powershell
npm ci
npm run tauri build
```

Then re-run the new versioned `.exe` over the old one. Your business data remains in `%LOCALAPPDATA%\com.smartaccountant.app\` and is untouched by re-install.

If the old app opens after updating, close it and check Windows **Installed Apps** for more than one SmartAccountant entry. Uninstall all app entries, keep `%LOCALAPPDATA%\com.smartaccountant.app\` untouched, and install the newest `.exe` once.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `'cargo' is not recognized` | Reopen PowerShell after installing Rust. |
| `link.exe not found` / MSVC errors | Reinstall **Desktop development with C++** workload in Visual Studio Installer. |
| `npm ci` ERESOLVE | Use Node **20.x** specifically. Delete `node_modules` and retry. |
| Build hangs on `windows-sys` | Normal on first build — let it finish (can take 15+ min). |
| White window after install | Make sure WebView2 Runtime is installed. |
| Antivirus blocks the `.exe` | Expected for unsigned installers — allow it, or sign the binary with your own code-signing cert. |

---

## What you do NOT need

- GitHub Actions
- The `.github/workflows/build.yml` workflow (left as manual-only — won't run on push)
- Any cloud build service
- Lovable preview running

Everything happens on your own machine.
