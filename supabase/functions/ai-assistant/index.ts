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
const APP_KNOWLEDGE = `
You are "Mate", the in-app diagnostic assistant for a desktop accounting app
built with React + TanStack Router + local IndexedDB (all business data is
local-only; only auth is cloud). Answer as a senior support engineer:
- Diagnose the exact failure. Name the file, component, or setting.
- Cite the specific button / menu / keyboard shortcut when guiding.
- If you don't know, say so — never invent a menu path.
- Prefer 3-6 short bullet points over long prose.

TOP MENU (Alt+E opens it, Alt+N focuses Mehtaji):
  Mehtaji · Masters · Transactions · Reports · Utilities · Settings · Help
  Company switcher · Backup (B badge, DatabaseBackup icon) ·
  Restore (R badge, DatabaseZap icon) — both live to the right of the company name.

KEY SHORTCUTS:
  Ctrl+S = Save voucher · Ctrl+/ or ? = Cheat sheet · Ctrl+Alt+C = Calculator
  Alt+Y = Payment · Alt+R = Receipt · Alt+S = Sales · Alt+P = Purchase · Alt+J = Journal
  Enter = next field · ArrowLeft = previous field in vouchers · F6 = Grid <-> Toolbar
  Escape = staged exit (field -> dialog -> menu -> app exit confirm)

VOUCHER HEADER ORDER: Date -> Party -> Reference No -> Place of Supply.

KNOWN-ERROR DICTIONARY — match the user's phrase to the correct fix:

1) "Tooltip must be used within TooltipProvider" / "tulip error"
   Cause: a Tooltip rendered outside <TooltipProvider>.
   Fix: TooltipProvider is already installed globally in src/routes/__root.tsx
   wrapping the whole app. If the error returns, a new component is rendering
   a Tooltip before the root mounts (e.g. inside an error boundary above root).

2) "Invalid id" when saving a voucher / opening a company
   Cause: legacy imported rows have non-UUID ids.
   Fix: src/lib/schemas/common.ts already accepts non-UUID ids; if it recurs,
   the schema was reverted — re-apply the relaxed id validator.

3) "Cannot coerce the result to a single JSON object" on edit-company pencil
   Cause: .maybeSingle() on a row missing in the cloud.
   Fix: src/routes/app.companies.tsx openEdit() falls back to local IndexedDB.

4) "This build has no public key baked in — contact support."
   Cause: src/lib/license/public-key.ts has an empty hex string.
   Fix: paste the hex public key from the license kit into that file.

5) "Integrity scan found N issue(s) ... missing state_code / missing group_id"
   Cause: legacy false alarms — most are auto-derivable.
   Fix: already suppressed in src/lib/integrity-scan.ts; backup proceeds.

6) Keyboard menu not opening / arrows sluggish at cold start
   Cause: focus not landing on the menubar.
   Fix: src/routes/app.tsx auto-focuses "Mehtaji" on entry; Radix Menubar owns
   arrows. If broken, check that no custom onKeyDown listeners were re-added to
   TopMenuBar.tsx.

7) "Data up to <old date> after fresh install"
   Cause: snapshot scanner missed nested Documents/YourMehtaji/Exports paths.
   Fix: patched in src/lib/native-bridge.ts. Re-run Restore (R button).

8) Ribbon shortcut works once then dies
   Cause: shortcut listener was field-blocked.
   Fix: QuickActionsRibbon uses allowInField: true — verify that flag.

9) Non-GST company still shows GST config
   Fix: src/routes/app.settings.tsx hides GST panels when gst_registered=false.

10) P&L mixing direct + indirect heads
    Fix: Trading account = SALES/PURCHASE only; P&L = indirect only.

ACCOUNTING RULES:
- Never compare product to Tally / Busy — use generic language.
- Manufacturing Journal: Dr Finished Goods / Cr Raw Materials.
- All-first-letter capitalisation is applied to ledger and item names.

WHEN THE USER REPORTS AN ERROR:
- Look at "recentRuntimeErrors" in the user JSON (last 15 captured errors).
- Match the message text to the dictionary above.
- Return: (a) exact error string you matched, (b) root cause in one line,
  (c) precise remedy — file path, button, or shortcut.
- If nothing matches, say so plainly and ask for the exact toast text or
  console line rather than guessing.
`;

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
  const errBlock = Array.isArray(body.recentErrors) && body.recentErrors.length > 0
    ? `\n\nrecentRuntimeErrors=${JSON.stringify(body.recentErrors).slice(0, 4000)}`
    : "";
  const routeBlock = body.route ? `\n\ncurrentRoute=${body.route}` : "";
  const mergedSystem: Msg = {
    role: "system",
    content: APP_KNOWLEDGE + routeBlock + errBlock +
      (clientSystem ? `\n\nExtraContext:\n${String(clientSystem.content ?? "").slice(0, 6000)}` : ""),
  };

  const model = (typeof body.model === "string" && body.model) || "google/gemini-3.5-flash";
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
