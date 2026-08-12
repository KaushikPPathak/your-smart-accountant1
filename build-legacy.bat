@echo off
REM ============================================================
REM Smart Accountant — Legacy Electron 22 Build Script (Windows)
REM Produces both Win 7 32-bit and 64-bit installers in one run.
REM Requires: Node.js 18+, electron-legacy/assets/app.ico present.
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === [1/4] Verifying icon ===
if not exist "electron-legacy\assets\app.ico" (
  echo ERROR: electron-legacy\assets\app.ico not found.
  echo Please place a 256x256 Windows .ico there and re-run.
  exit /b 1
)

echo.
echo === [2/4] Building web app with relative base ===
call npm ci || exit /b 1
call npx vite build --base=./ || exit /b 1
if not exist "dist\index.html" (
  echo ERROR: dist\index.html not produced by build.
  exit /b 1
)

echo.
echo === [3/4] Staging dist into electron-legacy\app ===
if exist "electron-legacy\app" rmdir /s /q "electron-legacy\app"
mkdir "electron-legacy\app"
xcopy /E /I /Y "dist\*" "electron-legacy\app\" >nul

echo.
echo === [4/4] Installing electron-legacy deps and packaging ===
pushd electron-legacy
call npm ci || (popd & exit /b 1)
call npm run dist:win || (popd & exit /b 1)
popd

echo.
echo === DONE ===
echo Installers:
dir /b electron-legacy\out\*.exe
endlocal
