// GSTIN verification proxy — API Setu GSTN Tax Payer API V2.
// Only the GSTIN is accepted from the caller. Credentials come exclusively
// from server secrets and are never logged, stored or returned.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

// 2-digit state code, 5 letters + 4 digits + 1 letter (PAN), entity code, 'Z', checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, status: 405, error: "Method not allowed" }, 405);
  }

  let gstinRaw: unknown;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    gstinRaw = (body as Record<string, unknown>).gstin; // only field ever read
  } catch {
    return json({ ok: false, status: 400, error: "Invalid JSON body" }, 400);
  }

  if (typeof gstinRaw !== "string") {
    return json({ ok: false, status: 400, error: "GSTIN is required" }, 400);
  }
  const gstin = gstinRaw.trim().toUpperCase();
  if (gstin.length !== 15 || !GSTIN_RE.test(gstin)) {
    return json({ ok: false, status: 400, error: "Invalid GSTIN format" }, 400);
  }

  const clientId = Deno.env.get("APISETU_CLIENT_ID");
  const apiKey = Deno.env.get("APISETU_API_KEY");
  if (!clientId || !apiKey) {
    return json({ ok: false, status: 500, error: "Server configuration error" }, 500);
  }

  try {
    const upstream = await fetch(`https://apisetu.gov.in/gstn/v2/taxpayers/${gstin}`, {
      method: "GET",
      headers: {
        "X-APISETU-CLIENTID": clientId,
        "X-APISETU-APIKEY": apiKey,
        Accept: "application/json",
      },
    });
    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { rawText: text };
    }
    return json({ ok: upstream.ok, status: upstream.status, json: payload }, 200);
  } catch {
    return json({ ok: false, status: 502, error: "API Setu request failed" }, 200);
  }
});
