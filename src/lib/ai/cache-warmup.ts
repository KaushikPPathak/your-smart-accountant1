// Cache Warm-up.
//
// After a company opens and the app is idle, silently ask the AI a handful of
// "first-thing-in-the-morning" questions so their answers land in the answer
// cache. When the user actually asks one, we return in ~0 ms instead of the
// 2-4 s round-trip. Runs at most once every 6 hours per company, only when
// the browser reports online, and never blocks the UI thread.

const LAST_RUN_KEY_PREFIX = "ym_ai_warmup_last_v1:";
const MIN_INTERVAL_MS = 1000 * 60 * 60 * 6; // 6 h
const QUESTION_SPACING_MS = 4000;

const WARMUP_QUESTIONS: string[] = [
  "What is today's cash balance?",
  "What is this month's total sales?",
  "Who are the top 5 overdue parties?",
  "What is the GST payable this month?",
  "Show me yesterday's entries.",
];

function lastRunKey(companyId: string) { return LAST_RUN_KEY_PREFIX + companyId; }

function shouldRun(companyId: string): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof localStorage === "undefined") return false;
  try {
    const last = Number(localStorage.getItem(lastRunKey(companyId)) ?? "0");
    return !last || Date.now() - last > MIN_INTERVAL_MS;
  } catch { return false; }
}

function markRan(companyId: string) {
  try { localStorage.setItem(lastRunKey(companyId), String(Date.now())); } catch { /* quota */ }
}

/**
 * Kick off warm-up in the background. Safe to call on every mount — throttled
 * by the 6-hour window. Completely silent: no toasts, no errors surfaced.
 */
export function scheduleWarmup(companyId: string | null | undefined) {
  if (!companyId) return;
  if (!shouldRun(companyId)) return;
  if (typeof window === "undefined") return;

  const start = () => { void runWarmup(companyId); };

  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(start, { timeout: 8000 });
  else setTimeout(start, 3000);
}

async function runWarmup(companyId: string) {
  // Mark first so a crash mid-run doesn't cause a hot loop.
  markRan(companyId);

  let assistantChat: ((args: { data: { messages: Array<{ role: string; content: string }>; companyId: string } }) => Promise<unknown>) | null = null;
  try {
    const mod = await import("@/lib/assistant.functions");
    assistantChat = mod.assistantChat as typeof assistantChat;
  } catch { return; }
  if (!assistantChat) return;

  for (const q of WARMUP_QUESTIONS) {
    try {
      await assistantChat({
        data: { messages: [{ role: "user", content: q }], companyId },
      });
    } catch { /* silent — offline / rate-limited / etc. */ }
    await new Promise((r) => setTimeout(r, QUESTION_SPACING_MS));
    if (typeof navigator !== "undefined" && navigator.onLine === false) break;
  }
}
