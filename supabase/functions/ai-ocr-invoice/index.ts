// Phase 3 — OCR bill → voucher draft.
//
// Accepts a base64-encoded image or PDF invoice, sends it to Gemini vision
// via the Lovable AI Gateway, and returns a structured JSON payload the
// client uses to build a voucher draft. Fuzzy-matching to local ledgers
// happens on the client (offline, phonetic engine) so this function stays
// stateless.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

interface Body {
  fileBase64?: string;
  mimeType?: string;
  filename?: string;
  hint?: "purchase" | "sales";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `You extract Indian GST invoice data. Read the attached image/PDF (an invoice, bill, or receipt) and return a SINGLE JSON object with these keys:

{
  "party_name":  string  // supplier/vendor name on the bill
  "party_gstin": string | null,
  "party_state": string | null,
  "party_address": string | null,
  "invoice_number": string | null,
  "invoice_date": string | null,   // YYYY-MM-DD; convert dd/mm/yyyy
  "place_of_supply": string | null,
  "items": [
     { "description": string,
       "hsn": string | null,        // HSN (goods, 4-8 digit) or SAC (services, starts 99)
       "quantity": number | null,
       "unit": string | null,       // NOS/PCS/KGS/LTR/NA...
       "rate": number | null,       // per-unit rate in rupees
       "amount": number,            // taxable value in rupees
       "gst_rate": number | null    // 0, 5, 12, 18, 28
     }
  ],
  "taxable_value": number,        // sum of items[].amount in rupees
  "cgst": number,                 // in rupees, 0 if IGST used
  "sgst": number,
  "igst": number,
  "cess": number,
  "round_off": number,
  "total_amount": number,         // grand total in rupees (paid/payable)
  "is_interstate": boolean,       // true when IGST is charged
  "notes": string | null,
  "confidence": number            // 0..1 — your overall confidence in this extraction
}

Rules:
- Return ONLY the JSON object, no prose, no fences.
- Use null when a field cannot be found — do NOT invent.
- All money values in rupees (float). Never in paise, never with the ₹ symbol.
- If the invoice is in Hindi/Gujarati/Marathi, translate field values to English but preserve names.
- If HSN code starts with '99' it is a Service (SAC). unit should then default to 'NA'.
- confidence < 0.4 means the image was unreadable — still return the shape with best-effort nulls.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ ok: false, error: "AI gateway not configured." }, 500);

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* fallthrough */ }
  const b64 = body.fileBase64;
  const mime = body.mimeType || "image/jpeg";
  if (!b64) return json({ ok: false, error: "fileBase64 required" }, 400);

  // Rough size guard — 15 MB base64 ≈ 11 MB binary, safe for Gemini.
  if (b64.length > 20_000_000) {
    return json({ ok: false, error: "File too large (>15 MB). Please compress or split." }, 413);
  }

  const dataUrl = b64.startsWith("data:") ? b64 : `data:${mime};base64,${b64}`;

  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: body.hint === "sales"
          ? "This is one of MY sales invoices to a customer. Extract the customer as party_name."
          : "This is a purchase bill/invoice I received from a supplier. Extract the supplier as party_name." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-lite",
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      if (res.status === 429) return json({ ok: false, error: "AI rate-limited. Retry shortly." });
      if (res.status === 402) return json({ ok: false, error: "AI credits exhausted. Add credits in Settings → Plans & credits." });
      return json({ ok: false, error: `Gateway error ${res.status}: ${raw.slice(0, 300)}` });
    }
    const out = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = out.choices?.[0]?.message?.content ?? "";
    // Robust JSON extraction — some models wrap in ```json fences.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ ok: false, error: "Model returned no JSON.", raw: text.slice(0, 500) });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) { return json({ ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : e}` }); }

    return json({ ok: true, extracted: parsed });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
