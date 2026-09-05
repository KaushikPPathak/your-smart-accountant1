// GST verification client — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.
// Credentials are stored in localStorage so the desktop build can call API Setu
// directly. For the web build, calls are proxied through a Supabase Edge
// Function to bypass browser CORS.

const LS_KEY = "ym_setu_creds_v1";

export interface SetuCreds {
  clientId: string;        // sent as X-APISETU-CLIENTID
  clientSecret: string;    // API Setu API key (sent as X-APISETU-APIKEY)
  productInstanceId?: string;
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
      localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_CREDS));
      return { ...DEFAULT_CREDS };
    }
    const parsed = JSON.parse(raw) as Partial<SetuCreds>;
    
    // Fall back to default key if localStorage has an empty key
    const clientSecret = parsed.clientSecret?.trim() || DEFAULT_CREDS.clientSecret;
    const clientId = parsed.clientId?.trim() || DEFAULT_CREDS.clientId;

    const creds: SetuCreds = {
      clientId,
      clientSecret,
      productInstanceId: parsed.productInstanceId ?? "",
      environment: parsed.environment === "sandbox" ? "sandbox" : "production",
    };

    // Ensure localStorage is updated with the active credentials
    localStorage.setItem(LS_KEY, JSON.stringify(creds));
    return creds;
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
  status: string;
  registrationDate?: string;
  taxpayerType?: string;
  constitutionOfBusiness?: string;
  natureOfBusinessActivities?: string[];
  principalPlaceOfBusiness?: string;
  raw?: unknown;
}

function compactAddress(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim() || undefined;
  if (typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const nested = compactAddress(
    obj.principalPlaceOfBusinessAddress ||
    obj.additionalPlaceOfBusinessAddress ||
    obj.address ||
    obj.addr ||
    obj.adr,
  );
  if (nested) return nested;
  const parts = [
    obj.bno || obj.buildingNumber || obj.bnumber,
    obj.flno || obj.floorNumber,
    obj.bnm || obj.buildingName,
    obj.st || obj.street || obj.streetName,
    obj.loc || obj.location || obj.locality,
    obj.landMark || obj.landmark || obj.lm,
    obj.city || obj.dst || obj.district || obj.districtName,
    obj.stcd || obj.state || obj.stateName,
    obj.pncd || obj.pincode || obj.pin,
  ];
  const joined = parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean).join(", ");
  return joined || undefined;
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
    // Desktop build — call API Setu directly with headers
    const url = `https://apisetu.gov.in/gstn/v2/taxpayers/${encodeURIComponent(cleanGstin)}`;
    const headers: Record<string, string> = {
      "X-APISETU-CLIENTID": creds.clientId,
      "X-APISETU-APIKEY": creds.clientSecret,
      Accept: "application/json",
    };
    try {
      const res = await fetch(url, { method: "GET", headers });
      httpOk = res.ok;
      httpStatus = res.status;
      try { json = await res.json(); } catch { /* ignore */ }
    } catch {
      // Fallback to web proxy if direct network request fails
      httpOk = false;
    }
  }

  if (!httpOk) {
    // Web build or direct fetch fallback — proxy through Supabase edge function
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("setu-gstin-proxy", {
        body: {
          gstin: cleanGstin,
          clientId: creds.clientId,
          apiKey: creds.clientSecret,
          clientSecret: creds.clientSecret,
        },
      });

      // If in offline local-only mode, cleanly open the portal without a crashing error
      if (error && error.message && error.message.includes("local-only mode")) {
        if (typeof window !== "undefined") {
          window.open("https://services.gst.gov.in/services/searchtp", "_blank");
        }
        return { ...empty };
      }

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

  const d = (json && (json.data || json)) || {};
  const legalName = String(d.legalName || d.legalNameOfBusiness || d.lgnm || "").trim();
  const tradeName = String(d.tradeName || d.tradeNameOfBusiness || d.tradNam || legalName).trim();
  const status = String(d.status || d.sts || d.gstinStatus || "").trim();
  const registrationDate = d.dateOfRegistration || d.rgdt || undefined;
  const taxpayerType = d.taxpayerType || d.dty || undefined;
  const constitutionOfBusiness = d.constitutionOfBusiness || d.ctb || undefined;
  const natureOfBusinessActivities = d.natureOfBusinessActivity || d.nba || undefined;
  const principalPlaceOfBusiness = compactAddress(
    d.principalPlaceOfBusinessFields?.principalPlaceOfBusinessAddress ||
    d.principalPlaceOfBusinessFields ||
    d.principalPlaceOfBusiness ||
    d.principalPlaceOfBusinessAddress ||
    d.pradr?.addr ||
    d.pradr?.adr ||
    d.pradr ||
    d.address ||
    d.additionalPlaceOfBusinessFields?.[0]?.additionalPlaceOfBusinessAddress,
  );

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
    principalPlaceOfBusiness,
    raw: json,
    error: undefined,
  };
}
