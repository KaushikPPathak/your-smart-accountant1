// GST verification client — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.
// API Setu credentials never reach the app. They live only in the server-side
// proxy (supabase/functions/setu-gstin-proxy) as environment secrets. The app
// sends only the GSTIN to that proxy. Books, vouchers and backups stay on this PC.

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

// The GSTIN lookup is the only feature that needs the internet (the government
// register lives online). It runs only when VITE_GSTIN_PROXY_URL is set at build
// time, pointing at the hosted setu-gstin-proxy function. If it is not set, the
// lookup is off and the user enters GSTIN details by hand. Only the GSTIN is sent.

export const GSTIN_LOOKUP_NOTICE =
  "Only the GSTIN is sent to the GST verification service. Your books stay on this PC.";

const GSTIN_OFFLINE_MESSAGE =
  "Online GSTIN check is not set up in this build. Enter the GSTIN details yourself.";

function proxyUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return (env.VITE_GSTIN_PROXY_URL ?? "").trim().replace(/\/+$/, "");
}

/** Sends only { gstin } to the hosted proxy. */
async function invokeDirect(gstin: string): Promise<{ data: unknown; error?: string }> {
  const url = proxyUrl();
  if (!url) return { data: null, error: GSTIN_OFFLINE_MESSAGE };
  try {
    // In the desktop app the request goes through the native HTTP plugin, so
    // it is not subject to the webview's CORS rules. Browsers use plain fetch.
    const w = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: unknown }) : undefined;
    const doFetch: typeof fetch = w?.__TAURI_INTERNALS__
      ? ((await import("@tauri-apps/plugin-http")).fetch as unknown as typeof fetch)
      : fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstin }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok && !json) {
      return { data: null, error: `GST verification failed (HTTP ${res.status}).` };
    }
    return { data: json };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("GST verification request failed:", err);
    return {
      data: null,
      error:
        /fetch|network|load failed/i.test(detail)
          ? `Could not reach the GST verification service. Check the internet connection and try again. You can still open the GST portal manually. (Technical detail: ${detail})`
          : `GST verification service unavailable. You can still open the GST portal manually. (Technical detail: ${detail})`,
    };
  }
}

/**
 * Verify a GSTIN via the hosted API Setu proxy. Only the GSTIN is sent.
 * This app never receives API Setu credentials.
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
    const direct = await invokeDirect(cleanGstin);
    if (direct.error && !direct.data) return { ...empty, error: direct.error };
    const data: any = direct.data;

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
