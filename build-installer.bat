@echo off
REM ============================================================
REM Smart Accountant — Legacy Installer Build Script (Windows)
REM Run from project root on any Windows 10/11 machine with:
REM   - Node.js 18+
REM   - NSIS 3.x (makensis on PATH, or in C:\Program Files (x86)\NSIS\)
REM   - legacy-installer\vendor\supermium\supermium.exe present
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === [1/5] Verifying Supermium bundle ===
if not exist "legacy-installer\vendor\supermium\supermium.exe" (
  echo ERROR: legacy-installer\vendor\supermium\supermium.exe not found.
  echo Download Supermium portable ZIP from https://win32subsystem.live/supermium/
  echo and extract it into legacy-installer\vendor\supermium\
  exit /b 1
)

echo.
echo === [2/5] Building web app (npm run build) ===
call npm ci || exit /b 1
call npm run build || exit /b 1
if not exist "dist\index.html" (
  echo ERROR: dist\index.html not produced by build.
  exit /b 1
)

echo.
echo === [3/5] Staging files ===
if exist "legacy-installer\staging" rmdir /s /q "legacy-installer\staging"
mkdir "legacy-installer\staging\app"
mkdir "legacy-installer\staging\browser"
xcopy /E /I /Y "dist\*"                                    "legacy-installer\staging\app\"     >nul
xcopy /E /I /Y "legacy-installer\vendor\supermium\*"       "legacy-installer\staging\browser\" >nul

echo.
echo === [4/5] Preparing output folder ===
if not exist "legacy-installer\out" mkdir "legacy-installer\out"

echo.
echo === [5/5] Running NSIS ===
set "MAKENSIS=makensis"
where makensis >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files (x86)\NSIS\makensis.exe" (
    set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
  ) else (
    echo ERROR: makensis not found. Install NSIS 3.x from https://nsis.sourceforge.io/Download
    exit /b 1
  )
)
pushd legacy-installer
"%MAKENSIS%" installer.nsi || (popd & exit /b 1)
popd

echo.
echo === DONE ===
echo Installer: legacy-installer\out\SmartAccountantSetup-Legacy-*.exe
echo Ship this single .exe to XP / 7 / 8 / 10 / 11 clients.
endlocal
