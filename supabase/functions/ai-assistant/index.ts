// Cloud AI fallback for the in-app assistant.
// Used when the browser cannot run the local WebGPU LLM. Proxies to the
// Lovable AI Gateway and returns a single completion.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

interface Msg { role: "system" | "user" | "assistant"; content: string }
interface Body {
  messages?: Msg[];
  temperature?: number;
  model?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ ok: false, error: "AI gateway is not configured." }, 500);

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* fallthrough */ }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return json({ ok: false, error: "messages required" }, 400);

  const model = (typeof body.model === "string" && body.model) || "google/gemini-3-flash-preview";
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.3;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: String(m.content ?? ""),
        })),
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
