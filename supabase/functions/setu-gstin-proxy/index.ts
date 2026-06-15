// Setu GSTIN verification proxy. The browser cannot call dg.setu.co directly
// because the upstream blocks CORS, so the SPA build proxies through here.
// Tauri/desktop builds may still call Setu directly.

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
  productInstanceId?: string;
  environment?: "production" | "sandbox";
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
    body.clientId || Deno.env.get("SETU_CLIENT_ID") || "com.shcglobaltrade";
  const clientSecret = body.clientSecret || Deno.env.get("SETU_API_KEY") || "";
  const productInstanceId =
    body.productInstanceId || Deno.env.get("SETU_PRODUCT_INSTANCE_ID") || "";
  const env = body.environment === "sandbox" ? "sandbox" : "production";

  if (!clientId || !clientSecret) {
    return json({ ok: false, status: 400, error: "Setu credentials not configured" }, 200);
  }

  const url =
    env === "sandbox"
      ? "https://dg-sandbox.setu.co/api/verify/gstin"
      : "https://dg.setu.co/api/verify/gstin";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-id": clientId,
    "x-client-secret": clientSecret,
  };
  if (productInstanceId) headers["x-product-instance-id"] = productInstanceId;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ gstin }),
    });
    let payload: unknown = null;
    try {
      payload = await upstream.json();
    } catch {
      /* ignore */
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
