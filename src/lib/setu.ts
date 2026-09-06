// GST verification client — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.
// All API Setu credentials stay server-side in Lovable Cloud Secrets.

export interface SetuCreds {
  clientId: string;
  clientSecret: string;
  productInstanceId?: string;
  environment: "production" | "sandbox";
}

export function loadSetuCreds(): SetuCreds {
  return {
    clientId: "",
    clientSecret: "",
    productInstanceId: "",
    environment: "production",
  };
}

export function saveSetuCreds(_creds: SetuCreds): void {
  // Credentials are intentionally not stored in the desktop/browser client.
}

export function isSetuConfigured(): boolean {
  // The API Setu credentials are configured server-side.
  return true;
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
      obj.adr
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

  return (
    parts
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter(Boolean)
      .join(", ") || undefined
  );
}

// The GSTIN lookup is one of the few features that legitimately needs the
// internet (the government register lives online). In local-only / desktop
// builds the Supabase client is a no-op stub, so we call the verification
// endpoint directly over HTTPS with the publishable key. No business data
// leaves the device — only the GSTIN being checked.
const FALLBACK_PROJECT_REF = "yzymutqvqwjeqnbygpgp";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6eW11dHF2cXdqZXFuYnlncGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTY2ODEsImV4cCI6MjA5NzA5MjY4MX0.-mtpRUvTSaxu_YPkqw8by6voYetpy5E2Y2mcWBnxd54";

function endpointBase(): { url: string; key: string } {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  const url = env.VITE_SUPABASE_URL || `https://${FALLBACK_PROJECT_REF}.supabase.co`;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_ANON_KEY;
  return { url: url.replace(/\/+$/, ""), key };
}

/** Direct HTTPS call to the GSTIN verification endpoint (no Supabase client needed). */
async function invokeDirect(gstin: string): Promise<{ data: unknown; error?: string }> {
  const { url, key } = endpointBase();
  try {
    const res = await fetch(`${url}/functions/v1/setu-gstin-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ gstin }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok && !json) {
      return { data: null, error: `GST verification failed (HTTP ${res.status}).` };
    }
    return { data: json };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error && /fetch|network/i.test(err.message)
          ? "No internet connection — GST verification needs to be online."
          : "GST verification service unavailable.",
    };
  }
}

/**
 * Verify a GSTIN via the Lovable Cloud API Setu proxy.
 * The desktop/browser client never receives API Setu credentials.
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

  try {
    const { supabase } = await import("@/integrations/supabase/client");

    let data: any = null;
    let errMessage: string | null = null;

    try {
      const res = await supabase.functions.invoke("setu-gstin-proxy", {
        body: { gstin: cleanGstin },
      });
      data = res.data;
      errMessage = res.error?.message ?? null;
    } catch (e) {
      errMessage = e instanceof Error ? e.message : "invoke failed";
    }

    // Local-only / desktop builds stub out the cloud client — go direct.
    if (!data || errMessage) {
      const direct = await invokeDirect(cleanGstin);
      if (direct.error && !direct.data) return { ...empty, error: direct.error };
      data = direct.data;
      errMessage = null;
    }

    const payload = data?.json ?? data;

    if (!data?.ok) {
      const message =
        payload?.message ||
        payload?.error ||
        data?.message ||
        `GST verification failed (HTTP ${data?.status ?? "unknown"}).`;
      return { ...empty, error: String(message) };
    }


    const d = (payload && (payload.data || payload)) || {};
    const legalName = String(
      d.legalName || d.legalNameOfBusiness || d.lgnm || ""
    ).trim();
    const tradeName = String(
      d.tradeName || d.tradeNameOfBusiness || d.tradNam || legalName
    ).trim();

    if (!legalName && !tradeName) {
      return { ...empty, error: "Invalid GSTIN or empty record." };
    }

    return {
      success: true,
      gstin: cleanGstin,
      legalName,
      tradeName: tradeName || legalName,
      status: String(d.status || d.sts || d.gstinStatus || "Active").trim(),
      registrationDate:
        d.dateOfRegistration || d.rgdt
          ? String(d.dateOfRegistration || d.rgdt)
          : undefined,
      taxpayerType:
        d.taxpayerType || d.dty
          ? String(d.taxpayerType || d.dty)
          : undefined,
      constitutionOfBusiness:
        d.constitutionOfBusiness || d.ctb
          ? String(d.constitutionOfBusiness || d.ctb)
          : undefined,
      natureOfBusinessActivities: Array.isArray(
        d.natureOfBusinessActivity || d.nba
      )
        ? (d.natureOfBusinessActivity || d.nba).map(String)
        : undefined,
      principalPlaceOfBusiness: compactAddress(
        d.principalPlaceOfBusinessFields ||
          d.principalPlaceOfBusiness ||
          d.pradr ||
          d.address
      ),
      raw: payload,
    };
  } catch (err) {
    console.error("GST verification error:", err);
    return {
      ...empty,
      error: err instanceof Error ? err.message : "GST verification failed.",
    };
  }
}
