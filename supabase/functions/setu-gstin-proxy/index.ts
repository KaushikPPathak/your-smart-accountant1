// GSTIN verification proxy — API Setu GSTN Tax Payer API V2.
// Only the GSTIN is accepted from the caller. Credentials come exclusively
// from server secrets and are never logged, stored or returned.
//
// Protection (the desktop app has no login, so these are the only gates):
//  1. Every request must carry x-install-id, a UUID the app generated on first run.
//  2. Each install gets SETU_PER_INSTALL_DAILY lookups per day (default 20).
//  3. The whole service stops at SETU_GLOBAL_DAILY lookups per day (default 500).
//     This cap bounds the bill even if an attacker invents install IDs.
// Counting is atomic in Postgres (public.setu_consume_lookup). Only the service role can call it.

import { createClient } from "npm:@supabase/supabase-js@2.103.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-install-id",
  "Access-Control-Max-Age": "86400",
};

// 2-digit state code, 5 letters + 4 digits + 1 letter (PAN), entity code, 'Z', checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function intFromEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, status: 405, error: "Method not allowed" }, 405);
  }

  const installId = (req.headers.get("x-install-id") ?? "").trim().toLowerCase();
  if (!INSTALL_ID_RE.test(installId)) {
    return json({ ok: false, status: 401, error: "Missing or invalid install id" }, 401);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, status: 413, error: "Request too large" }, 413);
  }

  let gstinRaw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new Error("too large");
    const body = JSON.parse(text);
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!clientId || !apiKey || !supabaseUrl || !serviceKey) {
    return json({ ok: false, status: 500, error: "Server configuration error" }, 500);
  }

  // Take one lookup from the allowance before calling API Setu. Refused lookups cost nothing.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const perInstall = intFromEnv("SETU_PER_INSTALL_DAILY", 20);
  const global = intFromEnv("SETU_GLOBAL_DAILY", 500);
  const { data: allowed, error: quotaError } = await admin.rpc("setu_consume_lookup", {
    p_install: installId,
    p_per_install: perInstall,
    p_global: global,
  });
  if (quotaError) {
    return json({ ok: false, status: 503, error: "Lookup service unavailable. Try again later." }, 503);
  }
  if (allowed !== true) {
    return json(
      { ok: false, status: 429, error: "Today's GSTIN lookup limit is reached. Enter the details by hand or try tomorrow." },
      429,
    );
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
