// Runtime error ring buffer.
// Captures the last N console errors, window.onerror events, and unhandled
// promise rejections. The AI assistant reads this when the user asks about
// bugs so it can name the exact failure instead of giving generic advice.

export interface CapturedError {
  at: string;          // ISO timestamp
  kind: "console" | "window" | "promise";
  message: string;
  stack?: string;
  source?: string;     // file url when available
  route?: string;      // window.location.pathname at capture time
}

const RING_MAX = 40;
const ring: CapturedError[] = [];
let installed = false;

function push(e: CapturedError) {
  ring.push(e);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function safeString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.message;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function installErrorRing(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const msg = args.map(safeString).filter(Boolean).join(" ").slice(0, 2000);
      if (msg) {
        push({
          at: new Date().toISOString(),
          kind: "console",
          message: msg,
          route: window.location?.pathname,
        });
      }
    } catch { /* ignore */ }
    origError(...args);
  };

  window.addEventListener("error", (ev: ErrorEvent) => {
    push({
      at: new Date().toISOString(),
      kind: "window",
      message: safeString(ev.message || ev.error).slice(0, 2000),
      stack: ev.error instanceof Error ? ev.error.stack?.slice(0, 2000) : undefined,
      source: ev.filename,
      route: window.location?.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    push({
      at: new Date().toISOString(),
      kind: "promise",
      message: safeString(ev.reason).slice(0, 2000),
      stack: ev.reason instanceof Error ? ev.reason.stack?.slice(0, 2000) : undefined,
      route: window.location?.pathname,
    });
  });
}

export function recentErrors(limit = 15): CapturedError[] {
  return ring.slice(-limit);
}

export function clearErrorRing(): void {
  ring.length = 0;
}

/** True when the user question is likely about an error/bug. */
export function questionMentionsError(q: string): boolean {
  const s = q.toLowerCase();
  return /\b(error|bug|broken|not working|doesn'?t work|didn'?t work|fail|failed|crash|freeze|stuck|blank|white screen|tooltip|tulip|invalid|cannot|can'?t|issue|problem|why|missing|wrong)\b/.test(s);
}
