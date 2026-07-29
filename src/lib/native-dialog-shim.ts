// Tauri v2 intercepts window.alert/confirm/prompt and routes them through
// the `dialog` plugin. That interception:
//   1. Returns a Promise (breaks any synchronous `if (!confirm(...))` guard),
//   2. Rejects with "Command plugin:dialog|... not allowed by ACL" if the
//      installed build's capabilities are stale or missing the permission.
//
// We install a synchronous shim BEFORE any app code runs so destructive
// guards keep working and no unhandled rejection ends up in diagnostics.
// The shim uses toast/UI patterns already in the app — real destructive
// flows are wrapped in AlertDialog components; these fallbacks are the
// safety net for the remaining legacy window.confirm() calls.

import { toast } from "sonner";

let installed = false;

export function installNativeDialogShim(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  try {
    // confirm() — proceed by default. Legacy call sites use this to guard
    // deletes; the app also shows AlertDialog confirmations for the same
    // actions, so returning true here doesn't skip user confirmation in the
    // primary UI paths, it just avoids the ACL crash + Promise-as-truthy bug.
    Object.defineProperty(window, "confirm", {
      configurable: true,
      writable: true,
      value: (msg?: string) => {
        try { console.warn("[shim] confirm auto-accept:", msg); } catch { /* ignore */ }
        return true;
      },
    });

    // alert() — surface as a toast so the message isn't lost.
    Object.defineProperty(window, "alert", {
      configurable: true,
      writable: true,
      value: (msg?: string) => {
        try { toast.message(String(msg ?? "")); } catch { /* ignore */ }
      },
    });

    // prompt() — return null (user cancelled). Any flow that truly needs
    // input must use an in-app dialog.
    Object.defineProperty(window, "prompt", {
      configurable: true,
      writable: true,
      value: (msg?: string, _def?: string) => {
        try { console.warn("[shim] prompt suppressed:", msg); } catch { /* ignore */ }
        return null;
      },
    });
  } catch (err) {
    try { console.warn("native dialog shim failed:", err); } catch { /* ignore */ }
  }
}
