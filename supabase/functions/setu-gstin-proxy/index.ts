// GSTIN verification proxy — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

interface ProxyBody {
  gstin?: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, status: 405, error: "Method not allowed" }, 405);
  }

  let body: ProxyBody = {};
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return json({ ok: false, status: 400, error: "Invalid JSON body" }, 400);
  }

  const gstin = (body.gstin || "").trim().toUpperCase();
  if (!/^[0-9A-Z]{15}$/.test(gstin)) {
    return json({ ok: false, status: 400, error: "Invalid GSTIN" }, 400);
  }

  const clientId =
    body.clientId ||
    Deno.env.get("APISETU_CLIENT_ID") ||
    "com.shcglobaltrade";
  
  const apiKey =
    body.apiKey ||
    body.clientSecret ||
    Deno.env.get("APISETU_API_KEY") ||
    Deno.env.get("SETU_API_KEY") ||
    "df93df0e036268e83bcffd824287952374c0b4aa624c25bc52df419f084a4743";

  const url = `https://apisetu.gov.in/gstn/v2/taxpayers/${encodeURIComponent(gstin)}`;

  const headers: Record<string, string> = {
    "X-APISETU-CLIENTID": clientId,
    "X-APISETU-APIKEY": apiKey,
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  try {
    const upstream = await fetch(url, { method: "GET", headers });
    let payload: unknown = null;
    try {
      payload = await upstream.json();
    } catch {
      payload = { rawText: await upstream.text() };
    }
    return json({ ok: upstream.ok, status: upstream.status, json: payload }, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, status: 0, error: `Upstream error: ${msg}` }, 200);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
