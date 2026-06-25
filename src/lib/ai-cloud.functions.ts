// Cloud AI fallback for the in-app assistant. Used when local WebGPU LLM
// is unavailable or fails to initialise. Runs server-side via Lovable AI Gateway.
import { createServerFn } from "@tanstack/react-start";

type Msg = { role: "system" | "user" | "assistant"; content: string };

interface ChatInput {
  messages: Msg[];
  temperature?: number;
  model?: string;
}

function parseInput(data: unknown): ChatInput {
  const d = (data ?? {}) as Partial<ChatInput>;
  if (!Array.isArray(d.messages) || d.messages.length === 0) {
    throw new Error("messages required");
  }
  return {
    messages: d.messages.map((m) => ({
      role: m.role === "assistant" || m.role === "system" ? m.role : "user",
      content: String(m.content ?? ""),
    })),
    temperature: typeof d.temperature === "number" ? d.temperature : 0.3,
    model: typeof d.model === "string" && d.model ? d.model : "google/gemini-3-flash-preview",
  };
}

export const cloudAssistantChat = createServerFn({ method: "POST" })
  .inputValidator(parseInput)
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return { ok: false, text: "", error: "AI gateway is not configured." };
    }
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
        },
        body: JSON.stringify({
          model: data.model,
          messages: data.messages,
          temperature: data.temperature,
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 429) return { ok: false, text: "", error: "AI is rate-limited. Please retry shortly." };
        if (res.status === 402) return { ok: false, text: "", error: "Workspace AI credits exhausted. Add credits in Settings → Plans & credits." };
        return { ok: false, text: "", error: `AI gateway error ${res.status}: ${body.slice(0, 200)}` };
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? "";
      return { ok: true, text };
    } catch (err) {
      return { ok: false, text: "", error: err instanceof Error ? err.message : String(err) };
    }
  });
