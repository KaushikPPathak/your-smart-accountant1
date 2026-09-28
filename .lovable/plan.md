# Fix desktop Exit Software

## Change
- Add one native desktop shutdown command that terminates the Tauri application directly.
- Route the shared desktop close helper through that command, while retaining the existing Electron and browser fallbacks.
- Keep the Administration Exit behavior unchanged; it continues returning to the company selection screen.

## Verification
- Add focused checks for the native close helper path.
- Run TypeScript/tests and a Tauri Rust compile check.
- Exercise the Escape confirmation flow in the desktop runtime where supported by the sandbox.

## Scope
- No visual, accounting, report, or data-storage changes.
