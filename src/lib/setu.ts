// GST verification client — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.
// Credentials are stored in localStorage so the desktop build can call API Setu
// directly. For the web build, calls are proxied through a Supabase Edge
// Function to bypass browser CORS.

const LS_KEY = "ym_setu_creds_v1";

export interface SetuCreds {
  clientId: string;        // sent as X-APISETU-CLIENTID
  clientSecret: string;    // API Setu API key (sent as X-APISETU-APIKEY)
  productInstanceId?: string; // unused (kept for back-compat with older saved creds)
  environment: "production" | "sandbox"; // unused for API Setu; kept for back-compat
}

const DEFAULT_CREDS: SetuCreds = {
  clientId: "com.shcglobaltrade",
  clientSecret: "",
  productInstanceId: "",
  environment: "production",
};

export function loadSetuCreds(): SetuCreds {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
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
  // On the web build, the proxy uses server-side env vars even if the local
  // field is blank — so we always allow attempts and let the proxy decide.
  return Boolean(c.clientId);
}

export interface SetuGstinResult {
  success: boolean;
  error?: string;
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  registrationDate?: string;
  taxpayerType?: string;
  constitutionOfBusiness?: string;
  natureOfBusinessActivities?: string[];
  principalPlaceOfBusiness?: string;
  raw?: unknown;
}

/**
 * Verify a GSTIN via API Setu's GSTN Tax Payer API V2.
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
  const isTauri =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  let json: any = null;
  let httpOk = false;
  let httpStatus = 0;

  if (isTauri) {
    // Desktop build — call API Setu directly.
    if (!creds.clientId || !creds.clientSecret) {
      return { ...empty, error: "API Setu credentials not configured" };
    }
    const url = `https://apisetu.gov.in/gstn/v2/taxpayers/${encodeURIComponent(cleanGstin)}`;
    const headers: Record<string, string> = {
      "X-APISETU-CLIENTID": creds.clientId,
      "X-APISETU-APIKEY": creds.clientSecret,
      Accept: "application/json",
    };
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...empty, error: `Network error: ${msg}` };
    }
    httpOk = res.ok;
    httpStatus = res.status;
    try { json = await res.json(); } catch { /* ignore */ }
  } else {
    // Web build — proxy through edge function (uses server-side env credentials).
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("setu-gstin-proxy", {
        body: {
          gstin: cleanGstin,
          // Forward locally-saved creds as overrides (proxy falls back to env if blank).
          clientId: creds.clientId || undefined,
          apiKey: creds.clientSecret || undefined,
        },
      });
      if (error) return { ...empty, error: `Proxy error: ${error.message}` };
      const resp = data as { ok: boolean; status: number; json: unknown; error?: string };
      if (resp?.error) return { ...empty, error: resp.error };
      httpOk = Boolean(resp?.ok);
      httpStatus = Number(resp?.status ?? 0);
      json = resp?.json ?? null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...empty, error: `Network error: ${msg}` };
    }
  }

  if (!httpOk) {
    const errMsg =
      (json && (json.error?.message || json.errorDescription || json.message || json.error)) ||
      `API Setu error ${httpStatus}`;
    return { ...empty, error: String(errMsg), raw: json };
  }

  // API Setu GSTN Tax Payer V2 returns GSTN's native field shape (lgnm/tradNam/etc.),
  // sometimes wrapped under `data`.
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
