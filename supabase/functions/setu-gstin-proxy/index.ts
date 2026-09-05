// GSTIN verification proxy — API Setu GSTN Tax Payer API V2.
// API Setu credentials are stored only in Lovable Cloud Secrets.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

interface ProxyBody {
  gstin?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json({ ok: false, status: 405, error: "Method not allowed" }, 405);
  }

  let body: ProxyBody;

  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return json({ ok: false, status: 400, error: "Invalid JSON body" }, 400);
  }

  const gstin = String(body.gstin || "")
    .trim()
    .toUpperCase();

  if (!gstin) {
    return json({ ok: false, status: 400, error: "GSTIN is required" }, 400);
  }

  const clientId = Deno.env.get("APISETU_CLIENT_ID");
  const apiKey = Deno.env.get("APISETU_API_KEY");

  if (!clientId || !apiKey) {
    console.error("API Setu secrets are not configured");
    return json(
      {
        ok: false,
        status: 500,
        error: "API Setu credentials are not configured on the server.",
      },
      500,
    );
  }

  const url = `https://apisetu.gov.in/gstn/v2/taxpayers/${encodeURIComponent(gstin)}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "X-APISETU-CLIENTID": clientId,
        "X-APISETU-APIKEY": apiKey,
        Accept: "application/json",
      },
    });

    let payload: unknown = null;

    try {
      payload = await upstream.json();
    } catch {
      payload = {
        rawText: await upstream.text(),
      };
    }

    return json(
      {
        ok: upstream.ok,
        status: upstream.status,
        json: payload,
      },
      200,
    );
  } catch (error) {
    console.error("API Setu request failed:", error);

    return json(
      {
        ok: false,
        status: 502,
        error: error instanceof Error ? error.message : "API Setu request failed.",
      },
      200,
    );
  }
});
