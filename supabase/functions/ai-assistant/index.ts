// Cloud AI fallback for the in-app assistant.
// Proxies to Lovable AI Gateway with a rich system prompt so the model can
// diagnose real app errors instead of giving generic "click here" advice.

import { ERROR_KB, renderErrorKb } from "./error-kb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

interface Msg { role: "system" | "user" | "assistant"; content: string }
interface RuntimeError {
  at?: string;
  kind?: string;
  message?: string;
  stack?: string;
  route?: string;
}
interface Body {
  messages?: Msg[];
  temperature?: number;
  model?: string;
  route?: string;
  recentErrors?: RuntimeError[];
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// App map + known-error dictionary. Keep this concise; the model reads it once.
// The huge error KB is only appended when the user is actually asking about
// an error — otherwise we ship the lean prompt to keep latency low.
const APP_KNOWLEDGE_CORE = `
You are "Mate", the in-app diagnostic assistant for a desktop accounting app
built with React + TanStack Router + local IndexedDB (all business data is
local-only; only auth is cloud). Answer as a senior support engineer:
- Diagnose the exact failure. Name the file, component, or setting.
- Cite the specific button / menu / keyboard shortcut when guiding.
- If you don't know, say so — never invent a menu path.
- Prefer 3-6 short bullet points over long prose.

TOP MENU (Alt+E opens it, Alt+N focuses Mehtaji):
  Mehtaji · Masters · Transactions · Reports · Utilities · Settings · Help
  Company switcher · Backup (B badge) · Restore (R badge) — right of company name.

KEY SHORTCUTS:
  Ctrl+S = Save · Ctrl+/ = Cheat sheet · Ctrl+Alt+C = Calculator
  Alt+Y Payment · Alt+R Receipt · Alt+S Sales · Alt+P Purchase · Alt+J Journal
  Enter = next field · ArrowLeft = previous field · F6 = Grid <-> Toolbar
  Escape = staged exit (field -> dialog -> menu -> app exit confirm)

VOUCHER HEADER ORDER: Date -> Party -> Reference No -> Place of Supply.
Never compare the product to Tally / Busy — use generic language.
`;

// Rendered once at cold start, not per request.
const ERROR_KB_BLOCK = `\n\nKNOWN-ERROR KB (${ERROR_KB.length} entries):\n\n${renderErrorKb()}\n\nWHEN THE USER REPORTS AN ERROR:\n- Match "recentRuntimeErrors" against the KB by symptom / cause keyword / id.\n- Return: KB id matched, exact error string, one-line root cause, precise remedy.\n- If nothing matches, ask for the exact toast text or console line.\n`;


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ ok: false, error: "AI gateway is not configured." }, 500);

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* fallthrough */ }
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) return json({ ok: false, error: "messages required" }, 400);

  // Prepend our knowledge system prompt; keep any client-supplied system as extra context.
  const clientSystem = incoming.find((m) => m.role === "system");
  const nonSystem = incoming.filter((m) => m.role !== "system");
  const hasErrors = Array.isArray(body.recentErrors) && body.recentErrors.length > 0;
  const errBlock = hasErrors
    ? `\n\nrecentRuntimeErrors=${JSON.stringify(body.recentErrors).slice(0, 4000)}`
    : "";
  const routeBlock = body.route ? `\n\ncurrentRoute=${body.route}` : "";
  // Only ship the huge error KB when the user is actually asking about an
  // error — cuts ~15-20k tokens off the average latency-sensitive question.
  const knowledge = APP_KNOWLEDGE_CORE + (hasErrors ? ERROR_KB_BLOCK : "");
  const mergedSystem: Msg = {
    role: "system",
    content: knowledge + routeBlock + errBlock +
      (clientSystem ? `\n\nExtraContext:\n${String(clientSystem.content ?? "").slice(0, 6000)}` : ""),
  };

  // Default to the fastest capable Gemini for chat latency; caller can override.
  const model = (typeof body.model === "string" && body.model) || "google/gemini-3.1-flash-lite";

  const temperature = typeof body.temperature === "number" ? body.temperature : 0.2;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model,
        messages: [mergedSystem, ...nonSystem.map((m) => ({
          role: m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: String(m.content ?? ""),
        }))],
        temperature,
        stream: false,
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      if (res.status === 429) return json({ ok: false, error: "AI is rate-limited. Please retry shortly." }, 200);
      if (res.status === 402) return json({ ok: false, error: "AI credits exhausted. Add credits in Settings → Plans & credits." }, 200);
      return json({ ok: false, error: `AI gateway error ${res.status}: ${raw.slice(0, 200)}` }, 200);
    }
    const out = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = out.choices?.[0]?.message?.content ?? "";
    return json({ ok: true, text });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
  }
});
