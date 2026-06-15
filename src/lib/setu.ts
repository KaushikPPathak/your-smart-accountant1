// Setu GST verification client.
// Credentials are stored in localStorage so the desktop/SPA build can call
// Setu directly without a server. For the web build, browsers may block the
// call via CORS — in that case wire a proxy in front of dg.setu.co.

const LS_KEY = "ym_setu_creds_v1";

export interface SetuCreds {
  clientId: string;        // sent as x-client-id (Setu "User ID")
  clientSecret: string;    // sent as x-client-secret (Setu "API Key")
  productInstanceId?: string; // optional, sent as x-product-instance-id
  environment: "production" | "sandbox";
}

const DEFAULT_CREDS: SetuCreds = {
  clientId: "com.shcglobaltrade",
  clientSecret: "df93df0e036268e83bcffd824287952374c0b4aa624c25bc52df419f084a4743",
  productInstanceId: "",
  environment: "production",
};

export function loadSetuCreds(): SetuCreds {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      // seed defaults on first load so the field is ready to use
      localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_CREDS));
      return { ...DEFAULT_CREDS };
    }
    const parsed = JSON.parse(raw) as Partial<SetuCreds>;
    return {
      clientId: parsed.clientId ?? DEFAULT_CREDS.clientId,
      clientSecret: parsed.clientSecret ?? DEFAULT_CREDS.clientSecret,
      productInstanceId: parsed.productInstanceId ?? "",
      environment: parsed.environment === "sandbox" ? "sandbox" : "production",
    };
  } catch {
    return { ...DEFAULT_CREDS };
  }
}

export function saveSetuCreds(creds: SetuCreds): void {
  localStorage.setItem(LS_KEY, JSON.stringify(creds));
}

export function isSetuConfigured(): boolean {
  const c = loadSetuCreds();
  return Boolean(c.clientId && c.clientSecret);
}

export interface SetuGstinResult {
  success: boolean;
  error?: string;
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;            // Active / Cancelled / Suspended
  registrationDate?: string;
  taxpayerType?: string;     // Regular / Composition / etc.
  constitutionOfBusiness?: string;
  natureOfBusinessActivities?: string[];
  principalPlaceOfBusiness?: string;
  raw?: unknown;
}

const BASE_URL_PROD = "https://dg.setu.co/api/verify/gstin";
const BASE_URL_SBX = "https://dg-sandbox.setu.co/api/verify/gstin";

/**
 * Verify a GSTIN via Setu's verification API.
 * Returns a normalised result regardless of which response variant Setu sends.
 */
export async function lookupGstinViaSetu(gstin: string): Promise<SetuGstinResult> {
  const cleanGstin = (gstin || "").trim().toUpperCase();
  const empty: SetuGstinResult = {
    success: false,
    gstin: cleanGstin,
    legalName: "",
    tradeName: "",
    status: "",
  };
  if (!cleanGstin) return { ...empty, error: "GSTIN is required" };
  const creds = loadSetuCreds();
  if (!creds.clientId || !creds.clientSecret) {
    return { ...empty, error: "Setu credentials not configured" };
  }

  const url = creds.environment === "sandbox" ? BASE_URL_SBX : BASE_URL_PROD;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-id": creds.clientId,
    "x-client-secret": creds.clientSecret,
  };
  if (creds.productInstanceId) {
    headers["x-product-instance-id"] = creds.productInstanceId;
  }

  const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  let json: any = null;
  let ok = false;
  let status = 0;

  if (isTauri) {
    // Desktop build can call Setu directly — no browser CORS.
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ gstin: cleanGstin }),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...empty, error: `Network/CORS error: ${msg}` };
    }
    ok = res.ok;
    status = res.status;
    try { json = await res.json(); } catch { /* ignore */ }
  } else {
    // Web build → proxy through Supabase Edge Function to bypass CORS.
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("setu-gstin-proxy", {
        body: {
          gstin: cleanGstin,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          productInstanceId: creds.productInstanceId,
          environment: creds.environment,
        },
      });
      if (error) return { ...empty, error: `Proxy error: ${error.message}` };
      const resp = data as { ok: boolean; status: number; json: unknown; error?: string };
      if (resp?.error) return { ...empty, error: resp.error };
      ok = Boolean(resp?.ok);
      status = Number(resp?.status ?? 0);
      json = resp?.json ?? null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...empty, error: `Network error: ${msg}` };
    }
  }

  if (!ok) {
    const errMsg =
      (json && (json.error?.message || json.message || json.error)) ||
      `Setu API error ${status}`;
    return { ...empty, error: String(errMsg), raw: json };
  }

  // Setu returns data either at the top level or inside `data`.
  const d = (json && (json.data || json)) || {};
  const legalName = String(d.legalName || d.legalNameOfBusiness || d.lgnm || "").trim();
  const tradeName = String(d.tradeName || d.tradeNameOfBusiness || d.tradNam || legalName).trim();
  const status = String(d.status || d.sts || d.gstinStatus || "").trim();
  const registrationDate = d.dateOfRegistration || d.rgdt || undefined;
  const taxpayerType = d.taxpayerType || d.dty || undefined;
  const constitutionOfBusiness = d.constitutionOfBusiness || d.ctb || undefined;
  const natureOfBusinessActivities = d.natureOfBusinessActivity || d.nba || undefined;
  const principalPlaceOfBusiness =
    (d.principalPlaceOfBusiness && (d.principalPlaceOfBusiness.address || d.principalPlaceOfBusiness)) ||
    d.pradr?.adr ||
    undefined;

  return {
    success: Boolean(legalName || tradeName),
    gstin: cleanGstin,
    legalName,
    tradeName: tradeName || legalName,
    status: status || "Active",
    registrationDate: registrationDate ? String(registrationDate) : undefined,
    taxpayerType: taxpayerType ? String(taxpayerType) : undefined,
    constitutionOfBusiness: constitutionOfBusiness ? String(constitutionOfBusiness) : undefined,
    natureOfBusinessActivities: Array.isArray(natureOfBusinessActivities)
      ? natureOfBusinessActivities.map(String)
      : undefined,
    principalPlaceOfBusiness: principalPlaceOfBusiness ? String(principalPlaceOfBusiness) : undefined,
    raw: json,
    error: undefined,
  };
}
