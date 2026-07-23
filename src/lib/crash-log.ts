// Layer 5 — local crash + failure telemetry.
//
// Records runtime errors and named failures (e.g. restore failure) to a
// bounded local ring buffer in localStorage. Never sent to any server —
// stays on the user's device. The user can view, export, or clear the
// log from Settings → Diagnostics.
//
// Design goals:
//  - Zero external deps, zero network.
//  - Safe in SSR / no-storage environments (all APIs no-op silently).
//  - Bounded (last 100 entries) so it can never grow unbounded.

const STORAGE_KEY = "crash-log.v1";
const MAX_ENTRIES = 100;

export interface CrashEntry {
  id: string;
  ts: number;                          // epoch ms
  kind: "error" | "unhandledrejection" | "failure";
  scope: string;                       // e.g. "restore", "backup", "window"
  message: string;
  stack?: string;
  context?: Record<string, unknown>;   // small JSON-safe extras
  app_version?: string;
  route?: string;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): CrashEntry[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as CrashEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: CrashEntry[]): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const capped = entries.slice(-MAX_ENTRIES);
    ls.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Storage full or blocked — drop silently. Never let telemetry break the app.
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jsonSafe(v: unknown, depth = 0): unknown {
  if (depth > 3) return "[deep]";
  if (v == null) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => jsonSafe(x, depth + 1));
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
      out[k] = jsonSafe(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

function currentRoute(): string | undefined {
  try {
    return typeof window !== "undefined" ? window.location.pathname : undefined;
  } catch {
    return undefined;
  }
}

/** Record a named failure (business flow — e.g. restore, backup). */
export function recordFailure(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const entries = readAll();
  const e: CrashEntry = {
    id: makeId(),
    ts: Date.now(),
    kind: "failure",
    scope,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    context: context ? (jsonSafe(context) as Record<string, unknown>) : undefined,
    route: currentRoute(),
  };
  entries.push(e);
  writeAll(entries);
}

/** List entries newest-first. */
export function listCrashes(): CrashEntry[] {
  return readAll().slice().reverse();
}

/** Clear the ring buffer. */
export function clearCrashes(): void {
  const ls = safeLocalStorage();
  if (ls) {
    try { ls.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

/** Serialize to a JSON string for user-driven export ("Send to support"). */
export function exportCrashes(): string {
  return JSON.stringify(
    { exported_at: new Date().toISOString(), entries: readAll() },
    null,
    2,
  );
}

let installed = false;

/** Install global window error handlers. Idempotent, browser-only. */
export function installCrashHandlers(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    const entries = readAll();
    entries.push({
      id: makeId(),
      ts: Date.now(),
      kind: "error",
      scope: "window",
      message: ev.message || "window error",
      stack: ev.error instanceof Error ? ev.error.stack : undefined,
      context: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
      route: currentRoute(),
    });
    writeAll(entries);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const entries = readAll();
    entries.push({
      id: makeId(),
      ts: Date.now(),
      kind: "unhandledrejection",
      scope: "window",
      message: reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection"),
      stack: reason instanceof Error ? reason.stack : undefined,
      route: currentRoute(),
    });
    writeAll(entries);
  });

  // Diagnose "app closed on its own after idle" reports. Record every
  // unload/hide with timing + visibility state so the crash log shows WHY
  // the window went away (user closed, tab hidden, WebView2 discarded,
  // OS killed the renderer, etc.). Extremely cheap — one localStorage write.
  const bootAt = Date.now();
  let lastActivityAt = Date.now();
  const bumpActivity = () => { lastActivityAt = Date.now(); };
  ["mousemove", "keydown", "pointerdown", "wheel", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, bumpActivity, { passive: true, capture: true });
  });

  const logLifecycle = (kind: string, extra?: Record<string, unknown>) => {
    const entries = readAll();
    entries.push({
      id: makeId(),
      ts: Date.now(),
      kind: "failure",
      scope: "lifecycle",
      message: kind,
      context: {
        uptime_ms: Date.now() - bootAt,
        idle_ms: Date.now() - lastActivityAt,
        visibility: typeof document !== "undefined" ? document.visibilityState : "unknown",
        online: typeof navigator !== "undefined" ? navigator.onLine : "unknown",
        ...(extra || {}),
      },
      route: currentRoute(),
    });
    writeAll(entries);
  };

  window.addEventListener("pagehide", (ev) => {
    logLifecycle("pagehide", { persisted: (ev as PageTransitionEvent).persisted });
  });
  window.addEventListener("beforeunload", () => { logLifecycle("beforeunload"); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") logLifecycle("visibility_hidden");
  });
}
