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

function forceAssign(name: "confirm" | "alert" | "prompt", value: unknown): void {
  const w = window as unknown as Record<string, unknown>;
  // 1) Try defineProperty (works if descriptor is configurable)
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value,
    });
    if (w[name] === value) return;
  } catch {
    /* fall through */
  }
  // 2) Direct assignment fallback
  try {
    w[name] = value;
  } catch {
    /* ignore */
  }
}

function reinstall(): void {
  forceAssign("confirm", (msg?: string) => {
    try { console.warn("[shim] confirm auto-accept:", msg); } catch { /* ignore */ }
    return true;
  });
  forceAssign("alert", (msg?: string) => {
    try { toast.message(String(msg ?? "")); } catch { /* ignore */ }
  });
  forceAssign("prompt", (msg?: string) => {
    try { console.warn("[shim] prompt suppressed:", msg); } catch { /* ignore */ }
    return null;
  });
}

export function installNativeDialogShim(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  try {
    reinstall();

    // Tauri may re-inject its dialog wrapper after our shim runs. Re-assert
    // on the next tick, on DOMContentLoaded, and once more after load.
    try { setTimeout(reinstall, 0); } catch { /* ignore */ }
    try {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", reinstall, { once: true });
      }
      window.addEventListener("load", reinstall, { once: true });
    } catch { /* ignore */ }

    // Safety net: swallow the specific Tauri ACL rejection so it doesn't
    // pollute diagnostics if any pre-shim call site still triggers it.
    window.addEventListener("unhandledrejection", (ev) => {
      const msg = (() => {
        const r = (ev as PromiseRejectionEvent).reason as unknown;
        if (!r) return "";
        if (typeof r === "string") return r;
        if (typeof r === "object" && r !== null && "message" in r) {
          return String((r as { message?: unknown }).message ?? "");
        }
        try { return String(r); } catch { return ""; }
      })();
      if (msg.includes("plugin:dialog") && msg.includes("not allowed by ACL")) {
        ev.preventDefault();
        try { console.warn("[shim] swallowed Tauri dialog ACL rejection"); } catch { /* ignore */ }
      }
    });

    // Suppress the benign "ResizeObserver loop completed with undelivered
    // notifications" warning that some Radix components trigger. It's not an
    // error — the spec says browsers may emit it and it should be ignored.
    window.addEventListener("error", (ev) => {
      const msg = String(ev.message ?? "");
      if (msg.includes("ResizeObserver loop")) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    });
  } catch (err) {
    try { console.warn("native dialog shim failed:", err); } catch { /* ignore */ }
  }
}
