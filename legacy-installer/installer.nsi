; Smart Accountant — Legacy Installer (Win XP SP3 → Win 11)
; Build with: makensis installer.nsi
; Requires: staging\app\ (web build) and staging\browser\supermium.exe

Unicode false          ; XP compatibility — Unicode NSIS requires Win 2000+
                       ; but the ANSI compiler produces installers that run on XP SP3
SetCompressor /SOLID lzma
RequestExecutionLevel user   ; per-user install; no admin needed

!define APP_NAME       "Smart Accountant"
!define APP_ID         "SmartAccountant"
!define APP_VERSION    "1.0.0"
!define APP_PUBLISHER  "Smart Accountant"
!define APP_EXE_NAME   "SmartAccountant.exe"   ; the tiny launcher we create
!define INSTALL_ROOT   "$LOCALAPPDATA\${APP_ID}"

Name       "${APP_NAME}"
OutFile    "out\SmartAccountantSetup-Legacy-${APP_VERSION}.exe"
InstallDir "${INSTALL_ROOT}"
ShowInstDetails show
ShowUninstDetails show

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON     "assets\app.ico"
!define MUI_UNICON   "assets\app.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

;-----------------------------------------------------------
Section "Smart Accountant" SEC_MAIN
  SetOutPath "$INSTDIR"

  ; 1. App files (the built web app: index.html + assets/)
  SetOutPath "$INSTDIR\app"
  File /r "staging\app\*.*"

  ; 2. Bundled Supermium (portable Chromium for XP/7/8/10/11)
  SetOutPath "$INSTDIR\browser"
  File /r "staging\browser\*.*"

  ; 3. Tiny launcher batch that starts Supermium in --app mode.
  ;    Kept as a .cmd wrapped by a shortcut so we don't need a compiled exe.
  SetOutPath "$INSTDIR"
  FileOpen  $0 "$INSTDIR\launch.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'start "" "%~dp0browser\supermium.exe" ^$\r$\n'
  FileWrite $0 '  --app=file:///%~dp0app/index.html ^$\r$\n'
  FileWrite $0 '  --user-data-dir="%LOCALAPPDATA%\${APP_ID}\profile" ^$\r$\n'
  FileWrite $0 '  --disable-features=TranslateUI ^$\r$\n'
  FileWrite $0 '  --window-size=1400,900$\r$\n'
  FileClose $0

  ; 4. Shortcuts — target the launcher .cmd, use bundled icon, hide console window
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk"                "$INSTDIR\launch.cmd" "" "$INSTDIR\browser\supermium.exe" 0 SW_SHOWMINIMIZED
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\launch.cmd" "" "$INSTDIR\browser\supermium.exe" 0 SW_SHOWMINIMIZED
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"   "$INSTDIR\uninstall.exe"

  ; 5. Uninstaller registration
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "DisplayIcon"     "$INSTDIR\browser\supermium.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" \
    "NoRepair" 1
SectionEnd

;-----------------------------------------------------------
; Uninstaller: removes app + browser, KEEPS the profile folder by default
; so client accounting data is never destroyed by a reinstall/uninstall.
Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\browser"
  Delete   "$INSTDIR\launch.cmd"
  Delete   "$INSTDIR\uninstall.exe"

  ; NOTE: profile\ intentionally preserved. Uninstall does NOT delete data.
  ; If the client wants a full wipe, they delete %LOCALAPPDATA%\SmartAccountant\ manually.

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
SectionEnd
